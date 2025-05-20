import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Injectable()
export class InventoryTransactionService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,
  ) {}

  /**
   * Create a new inventory transaction and update item stock.
   */
  async createTransaction(
    itemVariantId: number,
    transactionType: 'purchase' | 'sale',
    sqm: number,
  ): Promise<InventoryTransaction> {
    // Validate the item variant
    const itemVariant = await this.itemVariantRepository.findOne({
      where: { id: itemVariantId },
    });
    if (!itemVariant) {
      throw new NotFoundException(
        `ItemVariant with ID ${itemVariantId} not found.`,
      );
    }

    // Create the inventory transaction
    const transaction = this.inventoryTransactionRepository.create({
      itemVariant,
      transactionType,
      sqm,
    });

    await this.inventoryTransactionRepository.save(transaction);

    // Update inventory stock
    if (transactionType === 'purchase') {
      await this.itemVariantRepository.increment(
        { id: itemVariantId },
        'in',
        sqm,
      );
      await this.itemVariantRepository.increment(
        { id: itemVariantId },
        'balance',
        sqm,
      );
    } else if (transactionType === 'sale') {
      await this.itemVariantRepository.increment(
        { id: itemVariantId },
        'out',
        sqm,
      );
      await this.itemVariantRepository.decrement(
        { id: itemVariantId },
        'balance',
        sqm,
      );
    }

    return transaction;
  }

  /**
   * Get all inventory transactions.
   */
  async getAllTransactions(): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionRepository.find({
      relations: [
        // item hierarchy
        'itemVariant',
        'itemVariant.thickness',
        'itemVariant.thickness.item',
        // purchase side
        'purchaseInvoiceItem',
        'purchaseInvoiceItem.invoice',
        // sales side
        'invoiceItem',
        'invoiceItem.invoice',
      ],
      order: { transactionDate: 'DESC' },
    });
  }

  /**
   * Get inventory transactions for a specific item.
   */
  async getTransactionsByItem(
    itemVariantId: number,
  ): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionRepository.find({
      where: { itemVariant: { id: itemVariantId } },
      relations: ['itemVariant'],
    });
  }

  // src/inventory-transaction/inventory-transaction.service.ts

  async getActivity(): Promise<
    Array<{
      id: number;
      transactionType: string;
      sqm: number;
      quantity: number | null;
      thickness: string;
      itemName: string;
      length: number;
      width: number;
      sheetsPerBox: number;
      origin: string;
      itemType: string;
      invoiceDate: Date;
      invoiceNumber: string;
    }>
  > {
    const txs = await this.inventoryTransactionRepository.find({
      relations: [
        'itemVariant',
        'itemVariant.thickness',
        'itemVariant.thickness.item',
        'purchaseInvoiceItem',
        'purchaseInvoiceItem.invoice',
        'invoiceItem',
        'invoiceItem.invoice',
      ],
      order: { transactionDate: 'DESC' },
    });

    return txs.map((tx) => {
      // 1️⃣ Use the DB column directly
      const transactionType = tx.transactionType;

      // 2️⃣ Pick the correct invoice relation
      const invoice =
        transactionType === 'purchase'
          ? tx.purchaseInvoiceItem?.invoice
          : transactionType === 'sale'
            ? tx.invoiceItem?.invoice
            : undefined;

      // 3️⃣ Build invoiceDate (fallback to transactionDate)
      const invoiceDate = invoice?.date
        ? new Date(invoice.date)
        : tx.transactionDate;

      // 4️⃣ Grab invoiceNumber
      const invoiceNumber = invoice?.invoiceNumber ?? '—';

      // 5️⃣ Unpack variant → thickness → item
      const v = tx.itemVariant!;
      const t = v.thickness!;
      const i = t.item!;

      return {
        id: tx.id,
        transactionType,
        sqm: Number(tx.sqm),
        sqmofr: Number(tx.sqmofr),
        quantity: tx.quantity != null ? Number(tx.quantity) : null,
        quantityofr: tx.quantityofr != null ? Number(tx.quantityofr) : null,
        finalcost: tx.finalcost != null ? Number(tx.finalcost) : null,
        finalcostofr: tx.finalcostofr != null ? Number(tx.finalcostofr) : null,
        thickness: t.thickness.toString(),
        itemName: i.itemName,
        length: Number(v.length),
        width: Number(v.width),
        sheetsPerBox: Number(v.sheetsPerBox),
        origin: v.origin,
        itemType: i.type,
        invoiceDate,
        invoiceNumber,
      };
    });
  }
}
