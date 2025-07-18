import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransactionGateway } from './inventory-transaction.gateway';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { InvoiceItem } from 'src/entities/invoiceItem.entity';
import { Thickness } from 'src/entities/inventory/thickness.entity';
import { Item } from 'src/entities/inventory/item.entity';

@Injectable()
export class InventoryTransactionService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,
    @InjectRepository(ItemBatch)
    private readonly ItemBatchRepository: Repository<ItemBatch>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,

    @InjectRepository(Thickness)
    private readonly thicknessRepository: Repository<Thickness>,

    @InjectRepository(Item)
    private readonly itemRepository: Repository<Item>,
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

  async getActivity(
    page: number = 1,
    pageSize: number = 50,
  ): Promise<{
    data: Array<{
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
    }>;
    totals: {
      totalQuantity: number;
      totalQuantityOFR: number;
      totalSQM: number;
      totalSQMOFR: number;
    };
    totalRecords: number;
  }> {
    const baseQuery = this.inventoryTransactionRepository
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.itemVariant', 'itemVariant')
      .leftJoinAndSelect('itemVariant.thickness', 'thickness')
      .leftJoinAndSelect('thickness.item', 'item')
      .leftJoinAndSelect('tx.purchaseInvoiceItem', 'purchaseInvoiceItem')
      .leftJoinAndSelect('purchaseInvoiceItem.invoice', 'purchaseInvoice')
      .leftJoinAndSelect('tx.invoiceItem', 'invoiceItem')
      .leftJoinAndSelect('invoiceItem.invoice', 'salesInvoice')
      .leftJoinAndSelect('tx.inventoryCount', 'inventoryCount')
      .leftJoinAndSelect('tx.itemBatch', 'itemBatch')
      .orderBy('tx.transactionDate', 'DESC');

    // Clone for totals (no pagination)
    const allForTotals = await baseQuery.clone().getMany();

    // Clone for total count
    const totalRecords = await baseQuery.clone().getCount();

    // Apply pagination for the data fetch
    const paginatedRecords = await baseQuery
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    const formatRecords = (txs: any[]) =>
      txs
        .filter(
          (tx) =>
            tx.itemVariant &&
            tx.itemVariant.thickness &&
            tx.itemVariant.thickness.item,
        )
        .map((tx) => {
          let invoiceDateRaw: Date | string = tx.transactionDate;

          if (tx.transactionType === 'purchase') {
            invoiceDateRaw =
              tx.purchaseInvoiceItem?.invoice?.date ||
              tx.invoiceItem?.invoice?.date ||
              tx.transactionDate;
          } else if (tx.transactionType === 'sale') {
            invoiceDateRaw =
              tx.invoiceItem?.invoice?.date || tx.transactionDate;
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
            itemVariantId: tx.itemVariantId,
            sqm: Number(tx.sqm),
            sqmofr: Number(tx.sqmofr),
            quantity: tx.quantity != null ? Number(tx.quantity) : 0,
            quantityofr: tx.quantityofr != null ? Number(tx.quantityofr) : 0,
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

    const formattedTotals = formatRecords(allForTotals);
    const formattedPaginated = formatRecords(paginatedRecords);

    const totals = formattedTotals.reduce(
      (acc, curr) => {
        acc.totalQuantity += curr.quantity || 0;
        acc.totalQuantityOFR += curr.quantityofr || 0;
        acc.totalSQM += curr.sqm || 0;
        acc.totalSQMOFR += curr.sqmofr || 0;
        return acc;
      },
      { totalQuantity: 0, totalQuantityOFR: 0, totalSQM: 0, totalSQMOFR: 0 },
    );

    this.gateway.sendActivityUpdate(formattedPaginated);

    return { data: formattedPaginated, totals, totalRecords };
  }

  async getFilteredActivity(query: any): Promise<{
    data: any[];
    totals: {
      totalQuantity: number;
      totalQuantityOFR: number;
      totalSQM: number;
      totalSQMOFR: number;
    };
    totalRecords: number;
  }> {
    const qb = this.inventoryTransactionRepository
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.itemVariant', 'itemVariant')
      .leftJoinAndSelect('itemVariant.thickness', 'thickness')
      .leftJoinAndSelect('thickness.item', 'item')
      .leftJoinAndSelect('tx.purchaseInvoiceItem', 'purchaseInvoiceItem')
      .leftJoinAndSelect('purchaseInvoiceItem.invoice', 'purchaseInvoice')
      .leftJoinAndSelect('tx.invoiceItem', 'invoiceItem')
      .leftJoinAndSelect('invoiceItem.invoice', 'salesInvoice')
      .leftJoinAndSelect('tx.inventoryCount', 'inventoryCount')
      .leftJoinAndSelect('tx.itemBatch', 'itemBatch');

    if (query.itemBatchId) {
      qb.andWhere('itemBatch.id = :itemBatchId', {
        itemBatchId: query.itemBatchId,
      });
    }
    if (query.itemNameWithThickness) {
      const [thicknessValue, itemNameValue] =
        query.itemNameWithThickness.split('|');

      console.log(
        'Parsed Filter → Thickness:',
        thicknessValue,
        'Item Name:',
        itemNameValue,
      );

      const matchingItems = await this.itemRepository.find({
        where: { itemName: itemNameValue.trim() },
      });

      console.log(
        'Matching Items:',
        matchingItems.map((item) => ({
          id: item.id,
          name: item.itemName,
          type: item.type,
        })),
      );

      if (matchingItems.length > 0) {
        const itemIds = matchingItems.map((item) => item.id);

        const matchingThicknesses = await this.thicknessRepository.find({
          where: {
            thickness: Number(thicknessValue.trim()),
            item: In(itemIds),
          },
          relations: ['item'],
        });

        console.log(
          'Matching Thicknesses:',
          matchingThicknesses.map((t) => ({
            id: t.id,
            thickness: t.thickness,
            itemId: t.item.id,
          })),
        );

        if (matchingThicknesses.length > 0) {
          const thicknessIds = matchingThicknesses.map((t) => t.id);

          qb.andWhere('itemVariant.thicknessId IN (:...thicknessIds)', {
            thicknessIds,
          });

          qb.andWhere('item.itemName = :itemName', {
            itemName: itemNameValue.trim(),
          });

          console.log(
            'Applied Filter on InventoryTransaction with thicknessIds:',
            thicknessIds,
          );
          console.log('And on Item Name:', itemNameValue.trim());
        } else {
          console.log('No matching thicknesses found — forcing empty result');
          qb.andWhere('1 = 0');
        }
      } else {
        console.log('No matching items found — forcing empty result');
        qb.andWhere('1 = 0');
      }
    }

    if (query.condition) {
      qb.andWhere('itemBatch.condition LIKE :condition', {
        condition: `%${query.condition}%`,
      });
    }

    if (query.batchDate) {
      qb.andWhere('itemBatch.dateReceived = :batchDate', {
        batchDate: query.batchDate,
      });
    }

    if (query.origin) {
      qb.andWhere('itemVariant.origin LIKE :origin', {
        origin: `%${query.origin}%`,
      });
    }

    if (query.dimension) {
      const dimensionParts = query.dimension.split('-');
      if (dimensionParts.length >= 2) {
        const [lengthWidthPart, sheetsPerBoxPart] = dimensionParts;
        const [lengthStr, widthStr] = lengthWidthPart.split('×');

        if (!isNaN(Number(lengthStr)) && !isNaN(Number(widthStr))) {
          qb.andWhere('itemVariant.length = :length', {
            length: Number(lengthStr),
          });
          qb.andWhere('itemVariant.width = :width', {
            width: Number(widthStr),
          });

          if (
            sheetsPerBoxPart !== undefined &&
            !isNaN(Number(sheetsPerBoxPart))
          ) {
            qb.andWhere('itemVariant.sheetsPerBox = :sheetsPerBox', {
              sheetsPerBox: Number(sheetsPerBoxPart),
            });
          }
        }
      }
    }

    if (query.quantity) {
      qb.andWhere('tx.quantity = :quantity', { quantity: query.quantity });
    }

    if (query.quantityofr) {
      qb.andWhere('tx.quantityofr = :quantityofr', {
        quantityofr: query.quantityofr,
      });
    }

    if (query.sqm) {
      qb.andWhere('tx.sqm = :sqm', { sqm: query.sqm });
    }

    if (query.sqmofr) {
      qb.andWhere('tx.sqmofr = :sqmofr', { sqmofr: query.sqmofr });
    }

    if (query.finalcost) {
      qb.andWhere('tx.finalcost = :finalcost', { finalcost: query.finalcost });
    }

    if (query.finalcostofr) {
      qb.andWhere('tx.finalcostofr = :finalcostofr', {
        finalcostofr: query.finalcostofr,
      });
    }

    if (query.status) {
      qb.andWhere('tx.transactionType = :status', { status: query.status });
    }

    if (query.unit) {
      qb.andWhere('item.type = :unit', { unit: query.unit });
    }

    if (query.transactionType) {
      qb.andWhere('tx.transactionType = :transactionType', {
        transactionType: query.transactionType,
      });
    }

    if (query.date) {
      qb.andWhere('DATE(tx.transactionDate) = :date', { date: query.date });
    }

    if (query.invoiceNumber) {
      qb.andWhere(
        `(purchaseInvoice.invoiceNumber LIKE :invoiceNumber OR salesInvoice.invoiceNumber LIKE :invoiceNumber)`,
        { invoiceNumber: `%${query.invoiceNumber}%` },
      );
    }

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 30;

    const totalsQb = qb.clone(); // Correct: this has all filters, no skip/take
    const allForTotals = await totalsQb.getMany();

    const paginatedQb = qb.clone();
    const [txs, total] = await paginatedQb
      .orderBy('tx.transactionDate', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount(); // ✅ getManyAndCount still gives paginated count

    // But override total to be the count of all matching records before pagination
    const realTotalRecords = allForTotals.length;

    const result = txs.map((tx) => {
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
        quantity: tx.quantity != null ? Number(tx.quantity) : 0,
        quantityofr: tx.quantityofr != null ? Number(tx.quantityofr) : 0,
        finalcost: tx.finalcost != null ? Number(tx.finalcost) : null,
        finalcostofr: tx.finalcostofr != null ? Number(tx.finalcostofr) : null,
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

    const totals = allForTotals.reduce(
      (acc, tx) => {
        acc.totalQuantity += tx.quantity != null ? Number(tx.quantity) : 0;
        acc.totalQuantityOFR +=
          tx.quantityofr != null ? Number(tx.quantityofr) : 0;
        acc.totalSQM += tx.sqm != null ? Number(tx.sqm) : 0;
        acc.totalSQMOFR += tx.sqmofr != null ? Number(tx.sqmofr) : 0;
        return acc;
      },
      { totalQuantity: 0, totalQuantityOFR: 0, totalSQM: 0, totalSQMOFR: 0 },
    );

    console.log('Applied Filters:', query);
    console.log('Main Query SQL:', qb.getSql());
    console.log('Query Parameters:', qb.getParameters());
    console.log('Total Records Returned:', total);

    return { data: result, totals, totalRecords: realTotalRecords };
  }
}
