import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransactionGateway } from './inventory-transaction.gateway';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { InvoiceItem } from 'src/entities/invoiceItem.entity';

@Injectable()
export class InventoryTransactionService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,
    @InjectRepository(ItemBatch)
    private readonly ItemBatchRepository: Repository<ItemBatch>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,
    private readonly gateway: InventoryTransactionGateway,
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
      sqmofr: number;
      quantity: number | null;
      quantityofr: number | null;
      finalcost: number | null;
      finalcostofr: number | null;
      thickness: string;
      itemName: string;
      length: number;
      width: number;
      sheetsPerBox: number;
      origin: string;
      itemType: string;
      invoiceDate: string;
      invoiceNumber: string;
      itemBatch: {
        id: number;
        condition: string;
        dateReceived: string;
      } | null;
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
        'inventoryCount',
        'itemBatch',
      ],
      order: { transactionDate: 'DESC' },
    });

    const result = txs
      .filter(
        (tx) =>
          tx.itemVariant &&
          tx.itemVariant.thickness &&
          tx.itemVariant.thickness.item,
      )
      .map((tx) => {
        // ⬇️ Determine invoice date based on transaction type
        let invoiceDateRaw: Date | string = tx.transactionDate;

        if (tx.transactionType === 'purchase') {
          invoiceDateRaw =
            tx.purchaseInvoiceItem?.invoice?.date ||
            tx.invoiceItem?.invoice?.date ||
            tx.transactionDate;
        } else if (tx.transactionType === 'sale') {
          invoiceDateRaw = tx.invoiceItem?.invoice?.date || tx.transactionDate;
        } else {
          invoiceDateRaw =
            tx.inventoryCount?.date ||
            tx.invoiceItem?.invoice?.date ||
            tx.transactionDate;
        }

        const invoiceNumber =
          tx.transactionType === 'purchase'
            ? (tx.purchaseInvoiceItem?.invoice?.invoiceNumber ?? '—')
            : tx.transactionType === 'sale'
              ? (tx.invoiceItem?.invoice?.invoiceNumber ?? '—')
              : (tx.invoiceItem?.invoice?.invoiceNumber ?? '—');

        const v = tx.itemVariant!;
        const t = v.thickness!;
        const i = t.item!;

        return {
          id: tx.id,
          transactionType: tx.transactionType,
          sqm: Number(tx.sqm),
          sqmofr: Number(tx.sqmofr),
          quantity: tx.quantity != null ? Number(tx.quantity) : null,
          quantityofr: tx.quantityofr != null ? Number(tx.quantityofr) : null,
          finalcost: tx.finalcost != null ? Number(tx.finalcost) : null,
          finalcostofr:
            tx.finalcostofr != null ? Number(tx.finalcostofr) : null,
          thickness: t.thickness.toString(),
          itemName: i.itemName,
          length: Number(v.length),
          width: Number(v.width),
          sheetsPerBox: Number(v.sheetsPerBox),
          origin: v.origin,
          itemType: i.type,
          invoiceDate: new Date(invoiceDateRaw).toISOString().split('T')[0],
          invoiceNumber,
          itemBatch: tx.itemBatch
            ? {
                id: tx.itemBatch.id,
                condition: tx.itemBatch.condition,
                dateReceived: tx.itemBatch.dateReceived,
              }
            : null,
        };
      });

    this.gateway.sendActivityUpdate(result);
    return result;
  }
}
