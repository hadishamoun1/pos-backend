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
    description: {
      categoryName: string;
      subCategory: string;
      colorName: string;
      designName: string;
    } | null;

    // ───────── COST FIELDS (from PurchaseInvoiceItem or InvoiceItem) ─────────
    previousQuantity: number | null;
    previousQuantityC: number | null;
    previousQuantityVM: number | null;
    previousAverageCost: number | null;
    previousAverageCostC: number | null;
    previousAverageCostVM: number | null;
    previousAverageCostCVM: number | null;
    averageCost: number | null;
    averageCostC: number | null;
    averageCostCVM: number | null;
    averageCostVM: number | null;
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
    .leftJoinAndSelect('itemVariant.itemNameDescription', 'itemDesc')
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
    // pick the correct date & number
    let dateSrc: Date | string = tx.transactionDate;
    let numberSrc = '—';

    if (tx.purchaseInvoiceItemId && tx.purchaseInvoiceItem?.invoice) {
      dateSrc = tx.purchaseInvoiceItem.invoice.date;
      numberSrc = tx.purchaseInvoiceItem.invoice.invoiceNumber;
    } else if (tx.invoiceItemId && tx.invoiceItem?.invoice) {
      dateSrc = tx.invoiceItem.invoice.date;
      numberSrc = tx.invoiceItem.invoice.invoiceNumber;
    } else if (tx.inventoryCountId && tx.inventoryCount?.date) {
      dateSrc = tx.inventoryCount.date;
    } else if (tx.transferId && tx.transfer) {
      dateSrc = tx.transfer.date;
      numberSrc = tx.transfer.transferNumber;
    }

    const v = tx.itemVariant!;
    const t = v.thickness!;
    const i = t.item!;
    const desc = v.itemNameDescription;

    // 👉 COST SOURCE:
    // - Prefer PurchaseInvoiceItem (for purchases)
    // - Fallback to InvoiceItem (for sales)
    const costSrc: any = tx.purchaseInvoiceItem || tx.invoiceItem || {};

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
      description: desc
        ? {
            categoryName: desc.categoryName,
            subCategory: desc.subCategory,
            colorName: desc.colorName,
            designName: desc.designName,
          }
        : null,

      // ───────── COST FIELDS (from purchase or sales line) ─────────
      previousQuantity: costSrc.previousQuantity ?? null,
      previousQuantityC: costSrc.previousQuantityC ?? null,
      previousQuantityVM: costSrc.previousQuantityVM ?? null,
      previousAverageCost: costSrc.previousAverageCost ?? null,
      previousAverageCostC: costSrc.previousAverageCostC ?? null,
      previousAverageCostVM: costSrc.previousAverageCostVM ?? null,
      previousAverageCostCVM: costSrc.previousAverageCostCVM ?? null,
      averageCost: costSrc.averageCost ?? null,
      averageCostC: costSrc.averageCostC ?? null,
      averageCostCVM: costSrc.averageCostCVM ?? null,
      averageCostVM: costSrc.averageCostVM ?? null,
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
    .createQueryBuilder("tx")
    .leftJoinAndSelect("tx.itemVariant", "itemVariant")
    .leftJoinAndSelect("itemVariant.thickness", "thickness")
    .leftJoinAndSelect("thickness.item", "item")
    .leftJoinAndSelect("itemVariant.itemNameDescription", "itemDesc")
    // purchase
    .leftJoinAndSelect("tx.purchaseInvoiceItem", "purchaseInvoiceItem")
    .leftJoinAndSelect("purchaseInvoiceItem.invoice", "purchaseInvoice")
    // sales
    .leftJoinAndSelect("tx.invoiceItem", "invoiceItem")
    .leftJoinAndSelect("invoiceItem.invoice", "salesInvoice")
    // count
    .leftJoinAndSelect("tx.inventoryCount", "inventoryCount")
    // batch
    .leftJoinAndSelect("tx.itemBatch", "itemBatch");

  // ✅ IMPORTANT: single-line expression + aliased select
  const EFFECTIVE_DATE_SQL =
    "COALESCE(tx.dateForEachInvoice, purchaseInvoice.date, salesInvoice.date, inventoryCount.date, tx.transactionDate)";

  qb.addSelect(EFFECTIVE_DATE_SQL, "effectiveDate");

  // ✅ default sort so date works even when user doesn’t request sort
  qb.orderBy("effectiveDate", "DESC");

  /* ───────────────── helpers ───────────────── */

  const hasVal = (v: any) =>
    v !== undefined && v !== null && String(v).trim() !== "";

  // DO NOT use ESCAPE in MySQL via TypeORM here (it caused your syntax error).
  // Instead escape special chars manually for LIKE.
  const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

  const addStringFilter = (key: string, columnSql: string) => {
    // supports:
    // - keyEq
    // - keyContains
    // - key (backward compatible -> contains)
    const eq = query[`${key}Eq`];
    const contains = query[`${key}Contains`] ?? query[key];

    if (hasVal(eq)) {
      qb.andWhere(`${columnSql} = :${key}Eq`, {
        [`${key}Eq`]: String(eq).trim(),
      });
    }

    if (hasVal(contains)) {
      const raw = String(contains).trim();
      qb.andWhere(`${columnSql} LIKE :${key}Like`, {
        [`${key}Like`]: `%${escapeLike(raw)}%`,
      });
    }
  };

  const addNumberFilter = (key: string, columnSql: string) => {
    const eq = query[key];
    const gt = query[`${key}Gt`];
    const lt = query[`${key}Lt`];

    if (hasVal(eq)) qb.andWhere(`${columnSql} = :${key}`, { [key]: Number(eq) });
    if (hasVal(gt))
      qb.andWhere(`${columnSql} > :${key}Gt`, { [`${key}Gt`]: Number(gt) });
    if (hasVal(lt))
      qb.andWhere(`${columnSql} < :${key}Lt`, { [`${key}Lt`]: Number(lt) });
  };

  const parseDimension = (
    raw: any,
  ): { length: number; width: number; spb?: number } | null => {
    if (!hasVal(raw)) return null;

    const s = String(raw)
      .trim()
      .replace(/\u00A0/g, " ")
      .replace(/[xX*]/g, "×")
      .replace(/\s+/g, "");

    // 225×321 OR 225×321-031 / 225×321-31
    const m = s.match(/^(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)(?:-0*(\d+))?$/);
    if (!m) return null;

    const L = Number(m[1]);
    const W = Number(m[2]);
    if (!Number.isFinite(L) || !Number.isFinite(W)) return null;

    const out: any = { length: L, width: W };
    if (m[3] != null) out.spb = Number(m[3]);
    return out;
  };

  /* ───────────────── FILTERS ───────────────── */

  // description
  addStringFilter("category", "itemDesc.categoryName");
  addStringFilter("subCategory", "itemDesc.subCategory");
  addStringFilter("color", "itemDesc.colorName");
  addStringFilter("design", "itemDesc.designName");

  // batch
  addStringFilter("condition", "itemBatch.condition");
  if (hasVal(query.itemBatchId)) {
    qb.andWhere("itemBatch.id = :itemBatchId", {
      itemBatchId: Number(query.itemBatchId),
    });
  }
  if (hasVal(query.batchDate)) {
    qb.andWhere("itemBatch.dateReceived = :batchDate", {
      batchDate: query.batchDate,
    });
  }

  // origin / brand
  addStringFilter("origin", "itemVariant.origin");

  // unit
  if (hasVal(query.unit)) {
    qb.andWhere("item.type = :unit", { unit: query.unit });
  }

  // transactionType / status
  if (hasVal(query.transactionType)) {
    qb.andWhere("tx.transactionType = :tt", { tt: query.transactionType });
  }
  if (hasVal(query.status)) {
    qb.andWhere("tx.transactionType = :status", { status: query.status });
  }

  // invoice number
  const invEq = query.invoiceNumberEq;
  const invContains = query.invoiceNumberContains ?? query.invoiceNumber;
  if (hasVal(invEq)) {
    qb.andWhere(
      "(purchaseInvoice.invoiceNumber = :invEq OR salesInvoice.invoiceNumber = :invEq)",
      { invEq: String(invEq).trim() },
    );
  }
  if (hasVal(invContains)) {
    const raw = String(invContains).trim();
    qb.andWhere(
      "(purchaseInvoice.invoiceNumber LIKE :invLike OR salesInvoice.invoiceNumber LIKE :invLike)",
      { invLike: `%${escapeLike(raw)}%` },
    );
  }

  // date filters on effective date
  if (hasVal(query.date)) {
    qb.andWhere(`DATE(${EFFECTIVE_DATE_SQL}) = :filterDate`, {
      filterDate: query.date,
    });
  }
  if (hasVal(query.dateLt)) {
    qb.andWhere(`${EFFECTIVE_DATE_SQL} < :dateLt`, { dateLt: query.dateLt });
  }
  if (hasVal(query.dateGt)) {
    qb.andWhere(`${EFFECTIVE_DATE_SQL} > :dateGt`, { dateGt: query.dateGt });
  }

  // dimensions
  const dimRaw = query.dimensionEq ?? query.dimensionContains ?? query.dimension;
  const dim = parseDimension(dimRaw);
  if (dim) {
    qb.andWhere("itemVariant.length = :length", { length: dim.length });
    qb.andWhere("itemVariant.width = :width", { width: dim.width });
    if (dim.spb != null && Number.isFinite(dim.spb)) {
      qb.andWhere("itemVariant.sheetsPerBox = :spb", { spb: dim.spb });
    }
  }

  // exact thickness+itemName
  if (hasVal(query.itemNameWithThickness)) {
    const [thicknessValue, itemNameValue] = String(query.itemNameWithThickness)
      .split("|")
      .map((s) => s.trim());

    const th = Number(thicknessValue);
    if (Number.isFinite(th) && hasVal(itemNameValue)) {
      qb.andWhere("thickness.thickness = :thEq", { thEq: th });
      qb.andWhere("item.itemName = :itemNameEq", { itemNameEq: itemNameValue });
    } else {
      qb.andWhere("1 = 0");
    }
  }

  // contains search for "2ملم ابيض" style
  const nameContains = query.nameContains ?? query.itemNameContains;
  if (hasVal(nameContains)) {
    const s = String(nameContains).trim();

    const thMatch = s.match(/(\d+(?:\.\d+)?)\s*م?ل?م/i);
    const th = thMatch ? Number(thMatch[1]) : null;

    const rest = s.replace(/(\d+(?:\.\d+)?)\s*م?ل?م/i, "").trim();

    if (th != null && Number.isFinite(th)) {
      qb.andWhere("thickness.thickness = :thContains", { thContains: th });
    }
    if (hasVal(rest)) {
      qb.andWhere("item.itemName LIKE :itemNameLike", {
        itemNameLike: `%${escapeLike(rest)}%`,
      });
    }
    if (!hasVal(rest) && (th == null || !Number.isFinite(th))) {
      qb.andWhere("item.itemName LIKE :itemNameLike2", {
        itemNameLike2: `%${escapeLike(s)}%`,
      });
    }
  }

  // tx numeric fields
  addNumberFilter("quantity", "tx.quantity");
  addNumberFilter("quantityofr", "tx.quantityofr");
  addNumberFilter("sqm", "tx.sqm");
  addNumberFilter("sqmofr", "tx.sqmofr");
  addNumberFilter("finalcost", "tx.finalcost");
  addNumberFilter("finalcostofr", "tx.finalcostofr");

  // PurchaseInvoiceItem numeric fields
  const piiFields = [
    "previousQuantity",
    "previousQuantityC",
    "previousQuantityVM",
    "previousQuantityCVM",
    "previousAverageCost",
    "previousAverageCostC",
    "previousAverageCostVM",
    "previousAverageCostCVM",
    "averageCost",
    "averageCostC",
    "averageCostVM",
    "averageCostCVM",
  ] as const;

  for (const f of piiFields) {
    const eq = query[f];
    const gt = query[`${f}Gt`];
    const lt = query[`${f}Lt`];

    if (hasVal(eq))
      qb.andWhere(`purchaseInvoiceItem.${f} = :${f}`, { [f]: Number(eq) });
    if (hasVal(gt))
      qb.andWhere(`purchaseInvoiceItem.${f} > :${f}Gt`, {
        [`${f}Gt`]: Number(gt),
      });
    if (hasVal(lt))
      qb.andWhere(`purchaseInvoiceItem.${f} < :${f}Lt`, {
        [`${f}Lt`]: Number(lt),
      });
  }

  /* ───────────────── SORTING ───────────────── */

  if (hasVal(query.sortBy)) {
    const dir =
      String(query.sortDir || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";

    if (String(query.sortBy) === "date") {
      // ✅ THIS is the critical fix
      qb.orderBy("effectiveDate", dir);
    } else {
      const columnMap: Record<string, string> = {
        quantity: "tx.quantity",
        quantityofr: "tx.quantityofr",
        sqm: "tx.sqm",
        sqmofr: "tx.sqmofr",
        finalcost: "tx.finalcost",
        finalcostofr: "tx.finalcostofr",
        batchDate: "itemBatch.dateReceived",
        origin: "itemVariant.origin",

        previousQuantity: "purchaseInvoiceItem.previousQuantity",
        previousQuantityC: "purchaseInvoiceItem.previousQuantityC",
        previousQuantityVM: "purchaseInvoiceItem.previousQuantityVM",
        previousQuantityCVM: "purchaseInvoiceItem.previousQuantityCVM",
        previousAverageCost: "purchaseInvoiceItem.previousAverageCost",
        previousAverageCostC: "purchaseInvoiceItem.previousAverageCostC",
        previousAverageCostVM: "purchaseInvoiceItem.previousAverageCostVM",
        previousAverageCostCVM: "purchaseInvoiceItem.previousAverageCostCVM",
        averageCost: "purchaseInvoiceItem.averageCost",
        averageCostC: "purchaseInvoiceItem.averageCostC",
        averageCostVM: "purchaseInvoiceItem.averageCostVM",
        averageCostCVM: "purchaseInvoiceItem.averageCostCVM",
      };

      qb.orderBy(
        columnMap[String(query.sortBy)] || `tx.${String(query.sortBy)}`,
        dir,
      );
    }
  }

  /* ───────────────── PAGINATION + TOTALS ───────────────── */

  const pageNum = Number(query.page) || 1;
  const perPage = Number(query.pageSize) || 30;

  // remove ORDER BY from clones (MySQL hates orderBy in aggregate queries sometimes)
  const qbNoOrder = qb.clone();
  qbNoOrder.expressionMap.orderBys = {};

  const countRaw = await qbNoOrder
    .clone()
    .select("COUNT(DISTINCT tx.id)", "cnt")
    .getRawOne();
  const totalRecords = Number(countRaw?.cnt ?? 0);

  const totalsRaw = await qbNoOrder
    .clone()
    .select("COALESCE(SUM(tx.quantity), 0)", "totalQuantity")
    .addSelect("COALESCE(SUM(tx.quantityofr), 0)", "totalQuantityOFR")
    .addSelect("COALESCE(SUM(tx.sqm), 0)", "totalSQM")
    .addSelect("COALESCE(SUM(tx.sqmofr), 0)", "totalSQMOFR")
    .getRawOne();

  const transactions = await qb
    .skip((pageNum - 1) * perPage)
    .take(perPage)
    .getMany();

  /* ───────────────── SHAPE ───────────────── */

  const toNumOrNull = (v: any) => (v === null || v === undefined ? null : Number(v));

  const data = transactions.map((tx) => {
    let invoiceDateRaw: Date | string =
      (tx as any).dateForEachInvoice || (tx as any).transactionDate;

    if (tx.transactionType === "purchase") {
      invoiceDateRaw =
        tx.purchaseInvoiceItem?.invoice?.date ?? invoiceDateRaw;
    } else if (tx.transactionType === "sale") {
      invoiceDateRaw =
        tx.invoiceItem?.invoice?.date ?? invoiceDateRaw;
    } else if (tx.inventoryCount) {
      invoiceDateRaw = tx.inventoryCount.date ?? invoiceDateRaw;
    }

    const invoiceNumber =
      tx.transactionType === "purchase"
        ? tx.purchaseInvoiceItem?.invoice?.invoiceNumber ?? "—"
        : tx.transactionType === "sale"
          ? tx.invoiceItem?.invoice?.invoiceNumber ?? "—"
          : "—";

    const v = tx.itemVariant;
    const t = v?.thickness;
    const i = t?.item;
    const desc = v?.itemNameDescription;
    const pii = tx.purchaseInvoiceItem;

    return {
      id: tx.id,
      transactionType: tx.transactionType,

      sqm: Number(tx.sqm),
      sqmofr: Number(tx.sqmofr),
      quantity: tx.quantity ?? 0,
      quantityofr: tx.quantityofr ?? 0,
      finalcost: tx.finalcost != null ? Number(tx.finalcost) : null,
      finalcostofr: tx.finalcostofr != null ? Number(tx.finalcostofr) : null,

      thickness: t?.thickness?.toString() ?? "—",
      itemName: i?.itemName ?? "—",
      length: Number(v?.length ?? 0),
      width: Number(v?.width ?? 0),
      sheetsPerBox: Number(v?.sheetsPerBox ?? 0),
      origin: v?.origin ?? null,
      itemType: i?.type ?? null,

      invoiceDate: invoiceDateRaw
        ? new Date(invoiceDateRaw).toISOString().slice(0, 10)
        : "—",
      invoiceNumber,

      category: desc?.categoryName ?? null,
      subCategory: desc?.subCategory ?? null,
      color: desc?.colorName ?? null,
      design: desc?.designName ?? null,

      itemBatch: tx.itemBatch
        ? {
            id: tx.itemBatch.id,
            condition: tx.itemBatch.condition,
            dateReceived: tx.itemBatch.dateReceived,
          }
        : null,

      previousQuantity: toNumOrNull(pii?.previousQuantity),
      previousQuantityC: toNumOrNull(pii?.previousQuantityC),
      previousQuantityVM: toNumOrNull(pii?.previousQuantityVM),
      previousQuantityCVM: toNumOrNull(pii?.previousQuantityCVM),

      previousAverageCost: toNumOrNull(pii?.previousAverageCost),
      previousAverageCostC: toNumOrNull(pii?.previousAverageCostC),
      previousAverageCostVM: toNumOrNull(pii?.previousAverageCostVM),
      previousAverageCostCVM: toNumOrNull(pii?.previousAverageCostCVM),

      averageCost: toNumOrNull(pii?.averageCost),
      averageCostC: toNumOrNull(pii?.averageCostC),
      averageCostVM: toNumOrNull(pii?.averageCostVM),
      averageCostCVM: toNumOrNull(pii?.averageCostCVM),
    };
  });

  const totals = {
    totalQuantity: Number(totalsRaw?.totalQuantity ?? 0),
    totalQuantityOFR: Number(totalsRaw?.totalQuantityOFR ?? 0),
    totalSQM: Number(totalsRaw?.totalSQM ?? 0),
    totalSQMOFR: Number(totalsRaw?.totalSQMOFR ?? 0),
  };

  return { data, totals, totalRecords };
}

}
