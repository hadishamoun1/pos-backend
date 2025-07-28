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
import { Brackets } from 'typeorm';

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
      quantity: number;
      quantityofr: number;
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
      itemBatch: { id: number; condition: string; dateReceived: string } | null;
      transfer: { id: number; transferNumber: string; date: string } | null;
    }>;
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
      .leftJoinAndSelect('tx.itemBatch', 'itemBatch')
      .leftJoinAndSelect('tx.transfer', 'transfer')
      .orderBy('tx.id', 'DESC');

    // totals & count
    const allForTotals = await qb.clone().getMany();
    const totalRecords = allForTotals.length;

    // paged slice
    const pageData = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    const formatTx = (tx: any) => {
      // default fallback
      let dateSrc: Date | string = tx.transactionDate;
      let numberSrc = '—';

      // pick the non-null relation:
      if (tx.purchaseInvoiceItemId != null && tx.purchaseInvoiceItem?.invoice) {
        dateSrc = tx.purchaseInvoiceItem.invoice.date;
        numberSrc = tx.purchaseInvoiceItem.invoice.invoiceNumber;
      } else if (tx.invoiceItemId != null && tx.invoiceItem?.invoice) {
        dateSrc = tx.invoiceItem.invoice.date;
        numberSrc = tx.invoiceItem.invoice.invoiceNumber;
      } else if (tx.inventoryCountId != null && tx.inventoryCount?.date) {
        dateSrc = tx.inventoryCount.date;
      } else if (tx.transferId != null && tx.transfer) {
        dateSrc = tx.transfer.date;
        numberSrc = tx.transfer.transferNumber;
      }

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
        invoiceDate: new Date(dateSrc).toISOString().split('T')[0],
        invoiceNumber: numberSrc,
        itemBatch: tx.itemBatch
          ? {
              id: tx.itemBatch.id,
              condition: tx.itemBatch.condition,
              dateReceived: tx.itemBatch.dateReceived,
            }
          : null,
        transfer: tx.transfer
          ? {
              id: tx.transfer.id,
              transferNumber: tx.transfer.transferNumber,
              date: new Date(tx.transfer.date).toISOString().split('T')[0],
            }
          : null,
      };
    };

    const data = pageData.map(formatTx);
    const totals = allForTotals.map(formatTx).reduce(
      (acc, cur) => ({
        totalQuantity: acc.totalQuantity + cur.quantity,
        totalQuantityOFR: acc.totalQuantityOFR + cur.quantityofr,
        totalSQM: acc.totalSQM + cur.sqm,
        totalSQMOFR: acc.totalSQMOFR + cur.sqmofr,
      }),
      { totalQuantity: 0, totalQuantityOFR: 0, totalSQM: 0, totalSQMOFR: 0 },
    );

    this.gateway.sendActivityUpdate(data);
    return { data, totals, totalRecords };
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
      // purchase
      .leftJoinAndSelect('tx.purchaseInvoiceItem', 'purchaseInvoiceItem')
      .leftJoinAndSelect('purchaseInvoiceItem.invoice', 'purchaseInvoice')
      // sales
      .leftJoinAndSelect('tx.invoiceItem', 'invoiceItem')
      .leftJoinAndSelect('invoiceItem.invoice', 'salesInvoice')
      // count
      .leftJoinAndSelect('tx.inventoryCount', 'inventoryCount')
      // batch
      .leftJoinAndSelect('tx.itemBatch', 'itemBatch');

    // ─────────── DEFINE computed “effectiveDate” ───────────
    qb.addSelect(
      'COALESCE(purchaseInvoice.date, salesInvoice.date, inventoryCount.date, tx.transactionDate)',
      'effectiveDate',
    );

    // ─────────── FILTERS ───────────
    if (query.itemBatchId) {
      qb.andWhere('itemBatch.id = :itemBatchId', {
        itemBatchId: query.itemBatchId,
      });
    }
    if (query.itemNameWithThickness) {
      const [thicknessValue, itemNameValue] = query.itemNameWithThickness
        .split('|')
        .map((s) => s.trim());
      const matchingItems = await this.itemRepository.find({
        where: { itemName: itemNameValue },
      });
      if (matchingItems.length) {
        const itemIds = matchingItems.map((i) => i.id);
        const matchingThs = await this.thicknessRepository.find({
          where: { thickness: Number(thicknessValue), item: In(itemIds) },
          relations: ['item'],
        });
        if (matchingThs.length) {
          const thicknessIds = matchingThs.map((t) => t.id);
          qb.andWhere('itemVariant.thicknessId IN (:...thicknessIds)', {
            thicknessIds,
          });
          qb.andWhere('item.itemName = :itemName', { itemName: itemNameValue });
        } else {
          qb.andWhere('1 = 0');
        }
      } else {
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
    if (query.date) {
      qb.andWhere(
        `DATE(
           COALESCE(
             purchaseInvoice.date,
             salesInvoice.date,
             inventoryCount.date,
             tx.transactionDate
           )
         ) = :filterDate`,
        { filterDate: query.date },
      );
    }
    if (query.dimension) {
      const [dimPart, sheetsPart] = query.dimension.split('-');
      const [lengthStr, widthStr] = dimPart.split('×');
      if (!isNaN(+lengthStr) && !isNaN(+widthStr)) {
        qb.andWhere('itemVariant.length = :length', { length: +lengthStr });
        qb.andWhere('itemVariant.width = :width', { width: +widthStr });
        if (sheetsPart && !isNaN(+sheetsPart)) {
          qb.andWhere('itemVariant.sheetsPerBox = :spb', { spb: +sheetsPart });
        }
      }
    }
    if (query.quantity)
      qb.andWhere('tx.quantity = :quantity', { quantity: query.quantity });
    if (query.quantityofr)
      qb.andWhere('tx.quantityofr = :quantityofr', {
        quantityofr: query.quantityofr,
      });
    if (query.sqm) qb.andWhere('tx.sqm = :sqm', { sqm: query.sqm });
    if (query.sqmofr)
      qb.andWhere('tx.sqmofr = :sqmofr', { sqmofr: query.sqmofr });
    if (query.finalcost)
      qb.andWhere('tx.finalcost = :fc', { fc: query.finalcost });
    if (query.finalcostofr)
      qb.andWhere('tx.finalcostofr = :fcofr', { fcofr: query.finalcostofr });
    if (query.status)
      qb.andWhere('tx.transactionType = :status', { status: query.status });
    if (query.unit) qb.andWhere('item.type = :unit', { unit: query.unit });
    if (query.transactionType)
      qb.andWhere('tx.transactionType = :tt', { tt: query.transactionType });
    if (query.invoiceNumber) {
      qb.andWhere(
        `(purchaseInvoice.invoiceNumber LIKE :inv OR salesInvoice.invoiceNumber LIKE :inv)`,
        { inv: `%${query.invoiceNumber}%` },
      );
    }
    if (query.quantityGt)
      qb.andWhere('tx.quantity > :quantityGt', {
        quantityGt: query.quantityGt,
      });
    if (query.quantityLt)
      qb.andWhere('tx.quantity < :quantityLt', {
        quantityLt: query.quantityLt,
      });
    if (query.sqmGt) qb.andWhere('tx.sqm > :sqmGt', { sqmGt: query.sqmGt });
    if (query.sqmLt) qb.andWhere('tx.sqm < :sqmLt', { sqmLt: query.sqmLt });
    if (query.finalcostGt)
      qb.andWhere('tx.finalcost > :fcGt', { fcGt: query.finalcostGt });
    if (query.finalcostLt)
      qb.andWhere('tx.finalcost < :fcLt', { fcLt: query.finalcostLt });

    // ─────────── SORTING ───────────
    if (query.sortBy) {
      const dir =
        (query.sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      if (query.sortBy === 'date') {
        // ← sort by the computed alias for true chronological order
        qb.orderBy('effectiveDate', dir);
      } else {
        const columnMap: Record<string, string> = {
          quantity: 'tx.quantity',
          quantityofr: 'tx.quantityofr',
          sqm: 'tx.sqm',
          sqmofr: 'tx.sqmofr',
          finalcost: 'tx.finalcost',
          finalcostofr: 'tx.finalcostofr',
          batchDate: 'itemBatch.dateReceived',
        };
        qb.orderBy(columnMap[query.sortBy] || `tx.${query.sortBy}`, dir);
      }
    }

    // ─────────── PAGINATION & TOTALS ───────────
    const pageNum = Number(query.page) || 1;
    const perPage = Number(query.pageSize) || 30;
    const allForTotals = await qb.clone().getMany();
    const totalRecords = allForTotals.length;

    const [transactions] = await qb
      .skip((pageNum - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    // ─────────── SHAPE & RETURN ───────────
    const data = transactions.map((tx) => {
      let invoiceDateRaw: Date | string = tx.transactionDate;
      if (tx.transactionType === 'purchase') {
        invoiceDateRaw =
          tx.purchaseInvoiceItem?.invoice?.date ?? invoiceDateRaw;
      } else if (tx.transactionType === 'sale') {
        invoiceDateRaw = tx.invoiceItem?.invoice?.date ?? invoiceDateRaw;
      } else {
        invoiceDateRaw = tx.inventoryCount?.date ?? invoiceDateRaw;
      }

      const invoiceNumber =
        tx.transactionType === 'purchase'
          ? (tx.purchaseInvoiceItem?.invoice?.invoiceNumber ?? '—')
          : tx.transactionType === 'sale'
            ? (tx.invoiceItem?.invoice?.invoiceNumber ?? '—')
            : '—';

      const v = tx.itemVariant!;
      const t = v.thickness!;
      const i = t.item!;

      return {
        id: tx.id,
        transactionType: tx.transactionType,
        sqm: Number(tx.sqm),
        sqmofr: Number(tx.sqmofr),
        quantity: tx.quantity ?? 0,
        quantityofr: tx.quantityofr ?? 0,
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
      (acc, tx) => ({
        totalQuantity: acc.totalQuantity + Number(tx.quantity),
        totalQuantityOFR: acc.totalQuantityOFR + Number(tx.quantityofr),
        totalSQM: acc.totalSQM + Number(tx.sqm),
        totalSQMOFR: acc.totalSQMOFR + Number(tx.sqmofr),
      }),
      { totalQuantity: 0, totalQuantityOFR: 0, totalSQM: 0, totalSQMOFR: 0 },
    );

    return { data, totals, totalRecords };
  }
}
