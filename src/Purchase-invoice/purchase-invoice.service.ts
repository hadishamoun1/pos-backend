import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  In,
  Like,
  Raw,
  EntityManager,
  SelectQueryBuilder, 
    Brackets, 
} from 'typeorm';

import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { Account } from '../entities/account.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity.ts';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { PurchaseVoucherDetail } from '../entities/Vouchers/purchaseVoucherDetails.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { JournalVoucherDetail } from 'src/entities/Vouchers/journalVoucherDetails.entity';
import { JournalVoucher } from 'src/entities/Vouchers/journalVoucher.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { InventoryCount } from 'src/entities/inventory/count.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';
import { InvoiceItem } from 'src/entities/invoiceItem.entity';
export type Chain = "OFR" | "VM";

export const DEBUG_PREV = true;
export const DEBUG_PREV_QTY = true;
// if you want ALL rows printed (can be huge), set true
export const DEBUG_PREV_QTY_FULL = false;

export function dlog(scope: string, msg: string, data?: any) {
  if (!DEBUG_PREV) return;
  const t = new Date().toISOString();
  if (data !== undefined) console.log(`[${t}] [${scope}] ${msg}`, data);
  else console.log(`[${t}] [${scope}] ${msg}`);
}

export const num = (v: any, fb = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fb;




/**
 * Used by your other code (po rows calculations, weighted avgs, etc.)
 */
export const getItemQty = (it: any, chain: Chain) =>
  chain === "OFR"
    ? num(it?.sqmOfr ?? it?.sqmofr ?? it?.sqmOFR ?? 0) // supports different spellings
    : num(it?.sqm ?? 0);

export const getItemCost = (it: any, chain: Chain) =>
  chain === "OFR" ? num(it?.finalOFR ?? 0) : num(it?.finalCost ?? 0);

/**
 * ✅ ids for siblings baseline:
 * self + sheet + sqm siblings (same itemNameDescriptionId + thickness + length + width + origin)
 */
export async function getSheetSqmQtyVariantIds(
  variantRepo: Repository<ItemVariant>,
  variantId: number,
) {
  const scope = "PREV:getSheetSqmQtyVariantIds";
  dlog(scope, "start", { variantId });

  const base = await variantRepo.findOne({
    where: { id: variantId } as any,
    relations: ["thickness", "thickness.item"],
  });

  if (!base) {
    dlog(scope, "base not found -> self only");
    return [variantId];
  }

  // ✅ per your rule: use itemNameDescriptionId (NOT realDescriptionId)
  const descId = base.itemNameDescriptionId ?? null;
  const thk = base.thickness?.thickness ?? null;

  if (!descId || thk == null) {
    dlog(scope, "missing descId/thickness -> self only", { descId, thk });
    return [variantId];
  }

  const qb = variantRepo
    .createQueryBuilder("iv")
    .innerJoin("iv.thickness", "th")
    .innerJoin("th.item", "it")
    .select("iv.id", "id")
    .where("iv.itemNameDescriptionId = :descId", { descId })
    .andWhere("iv.length = :len", { len: base.length })
    .andWhere("iv.width = :wid", { wid: base.width })
    .andWhere("th.thickness = :thk", { thk })
    .andWhere("it.type IN (:...types)", { types: ["sheet", "sqm"] });

  if (base.origin != null) qb.andWhere("iv.origin = :o", { o: base.origin });
  else qb.andWhere("iv.origin IS NULL");

  const rows = await qb.getRawMany<{ id: any }>();
  const sibIds = rows
    .map((r) => Number(r.id))
    .filter((n) => Number.isFinite(n) && n > 0);

  const ids = Array.from(new Set([variantId, ...sibIds]));
  dlog(scope, "done", {
    base: {
      id: base.id,
      descId,
      thk,
      length: base.length,
      width: base.width,
      origin: base.origin,
    },
    ids,
  });

  return ids;
}

/** ✅ fallback avg from counts: OFR->finalCostOfr, VM->finalCost */
export async function countFallbackAvg(
  invManager: EntityManager,
  variantIds: number[],
  chain: Chain,
) {
  const scope = "PREV:countFallbackAvg";
  const field = chain === "OFR" ? "cnt.finalCostOfr" : "cnt.finalCost";

  const qb = invManager
    .getRepository(InventoryCount)
    .createQueryBuilder("cnt")
    .select(`${field}`, "cost")
    .where("cnt.itemVariantId IN (:...ids)", { ids: variantIds })
    .andWhere(`${field} IS NOT NULL`)
    .orderBy("cnt.id", "DESC")
    .limit(1);

  const row = await qb.getRawOne() as { cost?: string | number | null } | undefined;
  const cost = num(row?.cost, 0);

  dlog(scope, "done", { cost, row });
  return cost;
}

/**
 * ✅ fallback prevQty from counts:
 * - OFR MUST use sqmOfr strictly
 * - VM uses sqm
 */
export async function countFallbackPrevQty(
  invManager: EntityManager,
  variantIds: number[],
  chain: Chain,
) {
  const scope = "PREV:countFallbackPrevQty";
  const qtyField = chain === "OFR" ? "cnt.sqmOfr" : "cnt.sqm";

  const qb = invManager
    .getRepository(InventoryCount)
    .createQueryBuilder("cnt")
    .select(`SUM(COALESCE(${qtyField},0))`, "sumQty")
    .where("cnt.itemVariantId IN (:...ids)", { ids: variantIds });

  const raw = (await qb.getRawOne()) as { sumQty?: string | number | null } | undefined;
  const sumQty = num(raw?.sumQty, 0);

  dlog(scope, "done", { chain, sumQty, raw });
  return sumQty;
}

/**
 * ✅ SUM tx before cutoff (sales negative, purchases positive)
 * Returns { sum, txCount } so we can decide fallback when txCount==0
 */
async function sumTxQtyDetailed(
  inventoryTxRepo: Repository<InventoryTransaction>,
  variantIds: number[],
  chain: Chain,
  cutoff: Date,
  currPiiIds: number[],
): Promise<{ sum: number; txCount: number }> {
  const scope = "PREV:sumTxQty";

  // ⚠️ IMPORTANT:
  // If your entity property is sqmofr (lowercase), change tx.sqmOfr -> tx.sqmofr in BOTH places below.
  const col = chain === "OFR" ? "tx.sqmofr" : "tx.sqm";

  const applyBase = (
    qb: SelectQueryBuilder<InventoryTransaction>,
  ): SelectQueryBuilder<InventoryTransaction> => {
    qb.where("tx.itemVariantId IN (:...ids)", { ids: variantIds })
      .andWhere("tx.dateForEachInvoice < :cut", { cut: cutoff });

    if (currPiiIds.length) {
      qb.andWhere(
        "(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))",
        { currIds: currPiiIds },
      );
    }
    return qb;
  };

  // count rows
  const qbCount = applyBase(
    inventoryTxRepo.createQueryBuilder("tx").select("COUNT(*)", "cnt"),
  );
  const rawCount = (await qbCount.getRawOne()) as { cnt?: string | number } | undefined;
  const txCount = num(rawCount?.cnt, 0);

  // breakdown by transactionType
  try {
    const qbBreak = applyBase(
      inventoryTxRepo
        .createQueryBuilder("tx")
        .select("tx.transactionType", "type")
        .addSelect(`SUM(COALESCE(${col},0))`, "sum"),
    ).groupBy("tx.transactionType");

    const breakdown = await qbBreak.getRawMany();
    dlog(scope, "breakdown by transactionType", breakdown);
  } catch (e) {
    dlog(scope, "breakdown failed (ignore)", String(e));
  }

  // group by variantId (super useful with siblings)
  if (DEBUG_PREV_QTY) {
    try {
      const qbByVar = applyBase(
        inventoryTxRepo
          .createQueryBuilder("tx")
          .select("tx.itemVariantId", "variantId")
          .addSelect(`SUM(COALESCE(${col},0))`, "sum"),
      )
        .groupBy("tx.itemVariantId")
        .orderBy("tx.itemVariantId", "ASC");

      const byVar = await qbByVar.getRawMany();
      dlog(scope, `SUM by variant (${chain})`, byVar);
    } catch (e) {
      dlog(scope, "by-variant failed (ignore)", String(e));
    }
  }

  // row-level debug (details of quantities summed)
  if (DEBUG_PREV_QTY) {
    const qbRows = applyBase(
      inventoryTxRepo
        .createQueryBuilder("tx")
        .select("tx.id", "id")
        .addSelect("tx.itemVariantId", "variantId")
        .addSelect("tx.transactionType", "type")
        .addSelect("tx.dateForEachInvoice", "date")
        .addSelect("tx.purchaseInvoiceItemId", "piiId")
        .addSelect(`COALESCE(${col},0)`, "qty"),
    )
      .orderBy("tx.dateForEachInvoice", "ASC")
      .addOrderBy("tx.id", "ASC");

    // protect your console (limit)
    qbRows.limit(300);

    const rows = (await qbRows.getRawMany()) as Array<{
      id: any;
      variantId: any;
      type: any;
      date: any;
      piiId: any;
      qty: any;
    }>;

    const cleaned = rows.map((r) => ({
      id: Number(r.id),
      variantId: Number(r.variantId),
      type: r.type,
      date: r.date,
      piiId: r.piiId == null ? null : Number(r.piiId),
      qty: num(r.qty, 0), // ✅ THIS is what is being summed for prevQtyC / prevQtyVM
    }));

    const jsSum = cleaned.reduce((s, r) => s + r.qty, 0);

    dlog(scope, `ROWS used for prevQty (${chain}) [${col}]`, {
      cutoff: cutoff.toISOString(),
      variantIds,
      txCount,
      returnedRows: cleaned.length,
      jsSum,
      sampleFirst10: cleaned.slice(0, 10),
      sampleLast10: cleaned.slice(-10),
    });

    if (DEBUG_PREV_QTY_FULL) {
      console.log(`[${scope}] FULL ROWS`, cleaned);
    }
  }

  // authoritative SQL SUM
  const qbSum = applyBase(
    inventoryTxRepo
      .createQueryBuilder("tx")
      .select(`SUM(COALESCE(${col},0))`, "sum"),
  );

  const raw = (await qbSum.getRawOne()) as { sum?: string | number | null } | undefined;
  const sum = num(raw?.sum, 0);

  dlog(scope, "done", { txCount, sqlSum: sum, raw });
  return { sum, txCount };
}



/**
 * ✅ BACKWARD-COMPAT wrapper so your old calls compile:
 * prevQtyC = sumTxQty(..., "OFR", ...)   -> sums sqmOfr
 * prevQtyVM = sumTxQty(..., "VM", ...)  -> sums sqm
 */
export async function sumTxQty(
  inventoryTxRepo: Repository<InventoryTransaction>,
  variantIds: number[],
  chain: Chain,
  cutoff: Date,
  currPiiIds: number[],
) {
  const { sum } = await sumTxQtyDetailed(
    inventoryTxRepo,
    variantIds,
    chain,
    cutoff,
    currPiiIds,
  );
  return sum;
}

/**
 * ✅ PREV for AverageCost / AverageCostVM for (variant + siblings)
 * - prevQty from tx sum (OFR->sqmOfr, VM->sqm)
 * - if NO tx rows exist, fallback prevQty to counts (OFR strictly sqmOfr)
 * - prevAvg from latest previous PO among (variant + siblings)
 * - if no PO => fallback avg from counts (OFR->finalCostOfr, VM->finalCost)
 */
export async function resolvePrevVariant(
  itemRepo: Repository<PurchaseInvoiceItem>,
  inventoryTxRepo: Repository<InventoryTransaction>,
  invManager: EntityManager,
  variantRepo: Repository<ItemVariant>,
  variantId: number,
  chain: Chain,
  avgField: "averageCost" | "averageCostVM",
  dayStart: Date,
  currPiiIds: number[],
) {
  const scope = "PREV:resolvePrevVariant";
  dlog(scope, "start", {
    variantId,
    chain,
    avgField,
    dayStart: dayStart.toISOString(),
  });

  const qtyVariantIds = await getSheetSqmQtyVariantIds(variantRepo, variantId);

  const { sum: txSum, txCount } = await sumTxQtyDetailed(
    inventoryTxRepo,
    qtyVariantIds,
    chain,
    dayStart,
    currPiiIds,
  );

  let prevQty = txSum;

  // ✅ ONLY fallback when there are literally no tx rows
  if (txCount === 0) {
    const fbQty = await countFallbackPrevQty(invManager, qtyVariantIds, chain);
    dlog(scope, "prevQty fallback from counts (txCount==0)", {
      chain,
      txSum,
      fbQty,
    });
    prevQty = fbQty;
  }

 const prev = (await itemRepo
  .createQueryBuilder("pii")
  .innerJoin("pii.invoice", "inv")
  .where("pii.itemVariantId IN (:...ids)", { ids: qtyVariantIds })
  .andWhere("inv.status = :st", { st: "Recieved" })
  .andWhere("inv.date < :cut", { cut: dayStart })
  .andWhere(`pii.${avgField} IS NOT NULL`)
  .orderBy("inv.date", "DESC")
  .addOrderBy("pii.id", "DESC")
  .select([
    `pii.${avgField} AS avg`,
    "pii.itemVariantId AS vid",
    "inv.id AS invId",
    "inv.date AS invDate",
  ])
  .getRawOne()) as
  | { avg?: string | number | null; vid?: any; invId?: any; invDate?: any }
  | undefined;

    

  let prevAvg = 0;
  let avgFrom: "history" | "count" = "count";

  if (prev?.avg != null) {
    prevAvg = num(prev.avg, 0);
    avgFrom = "history";
  } else {
    prevAvg = await countFallbackAvg(invManager, qtyVariantIds, chain);
    avgFrom = "count";
  }

  dlog(scope, "done", {
    prevQty,
    prevAvg,
    avgFrom,
    qtyVariantIds,
    historyPick: prev,
  });

  return { prevQty, prevAvg, avgFrom, qtyVariantIds };
}

/**
 * Keep it available if you call it somewhere else.
 */
export async function openingsWeightedAvg(
  invManager: EntityManager,
  variantIds: number[],
  chain: Chain,
) {
  const scope = "PREV:openingsWeightedAvg";
  dlog(scope, "start", { chain, variantIdsCount: variantIds.length });

  const qtyField = chain === "OFR" ? "cnt.sqmOfr" : "cnt.sqm";
  const costField = chain === "OFR" ? "cnt.finalCostOfr" : "cnt.finalCost";

  const qb = invManager
    .getRepository(InventoryCount)
    .createQueryBuilder("cnt")
    .select(`COALESCE(${qtyField},0)`, "qty")
    .addSelect(`COALESCE(${costField},0)`, "cost")
    .where("cnt.itemVariantId IN (:...ids)", { ids: variantIds });

  const rows = (await qb.getRawMany()) as Array<{ qty: any; cost: any }>;

  const qty = rows.reduce((s, r) => s + num(r.qty, 0), 0);
  const wsum = rows.reduce((s, r) => s + num(r.qty, 0) * num(r.cost, 0), 0);
  const avg = qty > 0 ? wsum / qty : 0;

  dlog(scope, "done", { rowsCount: rows.length, qty, wsum, avg });
  return { qty, avg };
}

async function resolvePrevDesc(
  itemRepo: Repository<PurchaseInvoiceItem>,
  inventoryTxRepo: Repository<InventoryTransaction>,
  invManager: EntityManager,
  descId: number,
  variantIdsForDesc: number[],
  chain: Chain,
  avgField: 'averageCostC' | 'averageCostCVM',
  dayStart: Date,
  currPiiIds: number[],
) {
  const prev = await itemRepo
    .createQueryBuilder('pii')
    .innerJoin('pii.invoice', 'inv')
    .innerJoin('pii.itemVariant', 'iv')
    .where('inv.status = :st', { st: 'Recieved' })
    .andWhere('inv.date < :cut', { cut: dayStart })
    .andWhere('iv.itemNameDescriptionId = :descId', { descId })
    .andWhere(`pii.${avgField} IS NOT NULL`)
    .orderBy('inv.date', 'DESC')
    .addOrderBy('pii.id', 'DESC')
    .select([`pii.${avgField} AS avg`])
    .getRawOne<{ avg?: string | number | null }>();

  if (prev?.avg != null) {
    const prevQty = await sumTxQty(
      inventoryTxRepo,
      variantIdsForDesc,
      chain,
      dayStart,
      currPiiIds,
    );
    return { prevQty, prevAvg: num(prev.avg, 0), from: 'history' as const };
  }

  const open = await openingsWeightedAvg(invManager, variantIdsForDesc, chain);
  return { prevQty: open.qty, prevAvg: open.avg, from: 'openings' as const };
}




@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepo: Repository<PurchaseInvoice>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTxRepo: Repository<InventoryTransaction>,

    @InjectRepository(PurchaseVoucher)
    private readonly voucherRepo: Repository<PurchaseVoucher>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(UnitPriceModalRow)
    private readonly rowRepo: Repository<UnitPriceModalRow>,

    @InjectRepository(PurchaseInvoiceItem)
    private readonly itemRepo: Repository<PurchaseInvoiceItem>,

    @InjectRepository(ItemVariant)
    private readonly variantRepo: Repository<ItemVariant>,

    @InjectRepository(InventoryTransaction)
    private invTransRepo: Repository<InventoryTransaction>,

    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepo: Repository<JournalVoucher>,

    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepo: Repository<JournalVoucherDetail>,

    @InjectRepository(ItemBatch)
    private readonly itemBatchRepo: Repository<ItemBatch>,

    @InjectRepository(ItemNameDescription)
    private readonly descRepo: Repository<ItemNameDescription>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepo: Repository<InvoiceItem>,
  ) {}



  ///////////  IMPORTANT /////////////////
// functions responsible for recompute purchase invoices //
private clampPrevQty(raw: any, label: string, ctx: any = {}) {
  let n = Number(raw);
  if (!Number.isFinite(n)) n = 0;

  if (n < 0) {
    console.warn(`⚠️ ${label} was negative → clamped to 0`, { raw, n, ...ctx });
    n = 0;
  }

  return n;
}


private startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

private nextDayStart(d: Date) {
  const x = this.startOfDay(d);
  x.setDate(x.getDate() + 1);
  return x;
}

private uniqNums(xs: any[]) {
  return Array.from(new Set(xs.map(Number).filter(n => Number.isFinite(n) && n > 0)));
}

private async expandWithSiblings(variantIds: number[]) {
  const ids = this.uniqNums(variantIds);
  const out = new Set<number>(ids);

  for (const vid of ids) {
    try {
      const sibs = await getSheetSqmQtyVariantIds(this.variantRepo, vid);
      for (const s of sibs) out.add(Number(s));
    } catch {}
  }
  return Array.from(out);
}

private async getDescIdsForVariantIds(variantIds: number[]) {
  const ids = this.uniqNums(variantIds);
  if (!ids.length) return [];

  const rows = await this.variantRepo.find({
    where: { id: In(ids) },
    select: ['id', 'itemNameDescriptionId'] as any,
  });

  return this.uniqNums(rows.map((r: any) => r.itemNameDescriptionId).filter(Boolean));
}



private async applyPurchaseCostsForInvoice(invoiceId: number) {
  const scope = 'PO:COSTS';

  const savedInvoice = await this.invoiceRepo.findOne({
    where: { id: invoiceId },
    relations: ['items'], // we need items
  });

  if (!savedInvoice) return;
  if (savedInvoice.status !== 'Recieved') return;

  const invDate = new Date(savedInvoice.date);
  const dayStart = this.startOfDay(invDate);

  const items = savedInvoice.items ?? [];
  const currPiiIds = items
    .map((i: any) => i.id)
    .filter((x: any) => Number.isFinite(Number(x)));

  console.log(`[${scope}] start`, {
    invoiceId: savedInvoice.id,
    invoiceDate: savedInvoice.date,
    dayStart: dayStart.toISOString(),
    itemsCount: items.length,
  });

  // ---------- group items by description (descId)
  const itemVariantIds = this.uniqNums(items.map((i: any) => i.itemVariantId));
  const variantRows = itemVariantIds.length
    ? await this.variantRepo.find({
        where: { id: In(itemVariantIds) },
        select: ['id', 'itemNameDescriptionId'] as any,
      })
    : [];

  const variantToDesc = new Map<number, number | null>(
    variantRows.map((v: any) => [Number(v.id), v.itemNameDescriptionId ?? null]),
  );

  const itemsByDesc = new Map<number, any[]>();
  for (const it of items) {
    const descId = variantToDesc.get(Number(it.itemVariantId));
    if (descId == null) continue;
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(it);
  }
  const descIds = Array.from(itemsByDesc.keys());

  // ---------------------------
  // A) Per-variant (variant + siblings)
  // ---------------------------
for (const it of items) {
  const vid = Number(it.itemVariantId);
  if (!Number.isFinite(vid) || vid <= 0) continue;

  const prevOfr = await resolvePrevVariant(
    this.itemRepo,
    this.inventoryTxRepo,
    this.invTransRepo.manager,
    this.variantRepo,
    vid,
    'OFR',
    'averageCost',
    dayStart,
    currPiiIds,
  );

  const prevVm = await resolvePrevVariant(
    this.itemRepo,
    this.inventoryTxRepo,
    this.invTransRepo.manager,
    this.variantRepo,
    vid,
    'VM',
    'averageCostVM',
    dayStart,
    currPiiIds,
  );

  // ✅ clamp negatives to 0 before using in the formula
  const prevQtyOfr = this.clampPrevQty(prevOfr.prevQty, 'VAR:prevQty:OFR', {
    invoiceId: savedInvoice.id,
    vid,
  });
  const prevQtyVm = this.clampPrevQty(prevVm.prevQty, 'VAR:prevQty:VM', {
    invoiceId: savedInvoice.id,
    vid,
  });

  const poQtyOfr = getItemQty(it, 'OFR');
  const poCostOfr = getItemCost(it, 'OFR');

  const poQtyVm = getItemQty(it, 'VM');
  const poCostVm = getItemCost(it, 'VM');

  const totalOfr = prevQtyOfr + poQtyOfr;
  const newAvgOfr =
    totalOfr > 0
      ? (prevOfr.prevAvg * prevQtyOfr + poCostOfr * poQtyOfr) / totalOfr
      : prevOfr.prevAvg;

  const totalVm = prevQtyVm + poQtyVm;
  const newAvgVm =
    totalVm > 0
      ? (prevVm.prevAvg * prevQtyVm + poCostVm * poQtyVm) / totalVm
      : prevVm.prevAvg;



    await this.itemRepo.update(it.id, {
      previousQuantity: prevOfr.prevQty,
      previousAverageCost: prevOfr.prevAvg,
      averageCost: newAvgOfr,

      previousQuantityVM: prevVm.prevQty,
      previousAverageCostVM: prevVm.prevAvg,
      averageCostVM: newAvgVm,
    } as any);

    await this.variantRepo.update(vid, {
      averageCost: newAvgOfr,
      lastCost: poCostOfr,

      averageCostVM: newAvgVm,
      lastCostVM: poCostVm,
    } as any);
  }

  // ---------------------------
  // B) Per-description (C + CVM)
  // ---------------------------
  for (const descId of descIds) {
    const rows = itemsByDesc.get(descId) ?? [];
    if (!rows.length) continue;

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId } as any,
        select: ['id'] as any,
      })
    )
      .map((v: any) => Number(v.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (!variantIdsForDesc.length) continue;

    // prevQtyC = SUM(tx.sqmofr) before dayStart
 const rawPrevQtyC = await sumTxQty(
  this.inventoryTxRepo,
  variantIdsForDesc,
  'OFR',
  dayStart,
  currPiiIds,
);
const prevQtyC = this.clampPrevQty(rawPrevQtyC, 'DESC:prevQtyC', {
  invoiceId: savedInvoice.id,
  descId,
});

    const prevCRow = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.date < :cut', { cut: dayStart })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .andWhere('pii.averageCostC IS NOT NULL')
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC AS avg'])
      .getRawOne() as { avg?: string | number | null } | undefined;

    const fbC = await openingsWeightedAvg(this.invTransRepo.manager, variantIdsForDesc, 'OFR');
    const prevAvgC = prevCRow?.avg != null ? num(prevCRow.avg, 0) : fbC.avg;

    const poQtyC = rows.reduce((s, r) => s + getItemQty(r, 'OFR'), 0);
    const poWsumC = rows.reduce((s, r) => s + getItemQty(r, 'OFR') * getItemCost(r, 'OFR'), 0);
    const poCostC = poQtyC > 0 ? poWsumC / poQtyC : 0;

const totalC = prevQtyC + poQtyC;
const newAvgC =
  totalC > 0 ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalC : prevAvgC;

    // prevQtyCVM = SUM(tx.sqm) before dayStart
const rawPrevQtyCVM = await sumTxQty(
  this.inventoryTxRepo,
  variantIdsForDesc,
  'VM',
  dayStart,
  currPiiIds,
);
const prevQtyCVM = this.clampPrevQty(rawPrevQtyCVM, 'DESC:prevQtyCVM', {
  invoiceId: savedInvoice.id,
  descId,
});

    const prevCvmRow = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.date < :cut', { cut: dayStart })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .andWhere('pii.averageCostCVM IS NOT NULL')
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostCVM AS avg'])
      .getRawOne() as { avg?: string | number | null } | undefined;

    const fbCVM = await openingsWeightedAvg(this.invTransRepo.manager, variantIdsForDesc, 'VM');
    const prevAvgCVM = prevCvmRow?.avg != null ? num(prevCvmRow.avg, 0) : fbCVM.avg;

    const poQtyCVM = rows.reduce((s, r) => s + getItemQty(r, 'VM'), 0);
    const poWsumCVM = rows.reduce((s, r) => s + getItemQty(r, 'VM') * getItemCost(r, 'VM'), 0);
    const poCostCVM = poQtyCVM > 0 ? poWsumCVM / poQtyCVM : 0;

const rawTotalCVM = prevQtyCVM + poQtyCVM;
const totalCVM = rawTotalCVM < 0 ? 0 : rawTotalCVM;

const newAvgCVM =
  totalCVM > 0
    ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalCVM
    : prevAvgCVM;
    for (const r of rows) {
      await this.itemRepo.update(r.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,

        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      } as any);
    }

    const lastRow = rows[rows.length - 1] as any;
    await this.descRepo.update(descId, {
      averageCostC: newAvgC,
      averageCostCVM: newAvgCVM,
      lastCostC: getItemCost(lastRow, 'OFR'),
      lastCostCVM: getItemCost(lastRow, 'VM'),
    } as any);
  }

  console.log(`[${scope}] done`, { invoiceId: savedInvoice.id });
}


private async recomputePurchaseChainFrom(changedAtDate: Date, affectedVariantIds: number[]) {
  const scope = 'RECOMP:PURCHASE';
  const from = this.nextDayStart(changedAtDate); // ✅ only later days (because your logic uses dayStart)

  const expanded = await this.expandWithSiblings(affectedVariantIds);
  const affectedDescIds = await this.getDescIdsForVariantIds(expanded);

  console.log(`[${scope}] start`, {
    from: from.toISOString(),
    affectedVariantIdsCount: expanded.length,
    affectedDescIdsCount: affectedDescIds.length,
  });

  if (!expanded.length && !affectedDescIds.length) return;

  const qb = this.invoiceRepo
    .createQueryBuilder('pi')
    .innerJoin('pi.items', 'pii')
    .innerJoin('pii.itemVariant', 'iv')
    .where('pi.status = :st', { st: 'Recieved' })
    .andWhere('pi.date >= :from', { from })
    .andWhere(
      new Brackets((q) => {
        if (expanded.length) q.where('pii.itemVariantId IN (:...vids)', { vids: expanded });
        if (affectedDescIds.length) {
          if (expanded.length) q.orWhere('iv.itemNameDescriptionId IN (:...dids)', { dids: affectedDescIds });
          else q.where('iv.itemNameDescriptionId IN (:...dids)', { dids: affectedDescIds });
        }
      }),
    )
    .select(['pi.id AS id', 'pi.date AS date'])
    .groupBy('pi.id')
    .addGroupBy('pi.date')
    .orderBy('pi.date', 'ASC')
    .addOrderBy('pi.id', 'ASC');

  const raw = await qb.getRawMany<{ id: any; date: any }>();
  const invoiceIds = raw.map(r => Number(r.id)).filter(n => Number.isFinite(n) && n > 0);

  console.log(`[${scope}] invoices to recompute`, { count: invoiceIds.length, invoiceIds: invoiceIds.slice(0, 50) });

  for (const id of invoiceIds) {
    console.log(`[${scope}] recompute invoice`, { id });
    await this.applyPurchaseCostsForInvoice(id);
  }

  console.log(`[${scope}] done`, { recomputedCount: invoiceIds.length });
}


// 🧮 Recompute costs for sales invoice_items after a PO change
private async recomputeSalesCostsFrom(
  changedAtDate: Date,
  affectedVariantIds: number[],
) {
  const scope = 'RECOMP:SALES';

  const from = this.startOfDay(changedAtDate);
  const vids = this.uniqNums(affectedVariantIds);

  if (!vids.length) {
    console.log(`[${scope}] no affected variants -> skip`);
    return;
  }

  console.log(`[${scope}] start`, {
    from: from.toISOString(),
    affectedVariantIds: vids,
  });

  // Find all sales invoice items that:
  //  - have one of the affected variants
  //  - belong to invoices on/after the change date
  const rows = await this.invoiceItemRepo
    .createQueryBuilder('ii')
    .innerJoin('ii.invoice', 'inv')
    .where('ii.itemVariantId IN (:...vids)', { vids })
    .andWhere('inv.date >= :from', { from })
    .select([
      'ii.id AS id',
      'ii.itemVariantId AS itemVariantId',
      'inv.id AS invoiceId',
      'inv.date AS invoiceDate',
    ])
    .orderBy('inv.date', 'ASC')
    .addOrderBy('inv.id', 'ASC')
    .addOrderBy('ii.id', 'ASC')
    .getRawMany<{
      id: number;
      itemVariantId: number;
      invoiceId: number;
      invoiceDate: Date;
    }>();

  console.log(`[${scope}] affected sales items`, {
    count: rows.length,
  });

  if (!rows.length) {
    console.log(`[${scope}] nothing to recompute -> done`);
    return;
  }

  // Cache purchase avg costs per (variant, date) so we don't query 1000x
  const costCache = new Map<
    string,
    {
      averageCost: number | null;
      averageCostC: number | null;
      averageCostVM: number | null;
      averageCostCVM: number | null;
    }
  >();

  const updates: { id: number; data: Partial<InvoiceItem> }[] = [];

  for (const r of rows) {
    const vid = Number(r.itemVariantId);
    if (!Number.isFinite(vid) || vid <= 0) continue;

    const invDate = new Date(r.invoiceDate);
    const dateKey = invDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${vid}:${dateKey}`;

    if (!costCache.has(key)) {
      // 🔎 Get the purchase-side averages as of this sales invoice date
      const costs = await this.getPurchaseAvgCostsAsOf(vid, invDate);
      costCache.set(key, costs);
    }

    const costs = costCache.get(key)!;

    updates.push({
      id: Number(r.id),
      data: {
        averageCost: costs.averageCost,
        averageCostC: costs.averageCostC,
        averageCostVM: costs.averageCostVM,
        averageCostCVM: costs.averageCostCVM,

        // For now we mirror lastCost* to the average at that date
        lastCost: costs.averageCost,
        lastCostC: costs.averageCostC,
        lastCostVM: costs.averageCostVM,
        lastCostCVM: costs.averageCostCVM,
      },
    });
  }

  // Apply updates
  for (const u of updates) {
    await this.invoiceItemRepo.update(u.id, u.data);
  }

  console.log(`[${scope}] done`, { updatedCount: updates.length });
}





  private async getNextPvNumber(prefix: string): Promise<string> {
    // Find the last voucher whose pvNumber starts with e.g. "PVG-"
    const last = await this.voucherRepo
      .createQueryBuilder('v')
      .where('v.pvNumber LIKE :pref', { pref: `${prefix}-%` })
      .orderBy('v.pvNumber', 'DESC')
      .limit(1)
      .getOne();

    let nextSeq = 1;
    if (last?.pvNumber) {
      // extract the numeric part after the dash
      const match = last.pvNumber.match(/-(\d+)$/);
      if (match && match[1]) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}-${String(nextSeq).padStart(3, '0')}`;
  }
  





  async create(data: Partial<PurchaseInvoice>) {
    // 1) save invoice + items
    const invoice = this.invoiceRepo.create(data);
    const savedInvoice = await this.invoiceRepo.save(invoice);

    // 2) record inventory transactions
    if (savedInvoice.status === 'Recieved') {
      const invTxs: InventoryTransaction[] = [];
      const invoiceDate = new Date(savedInvoice.date);

      for (const item of savedInvoice.items) {
        let qty = Number(item.quantity);
        let sqm = Number(item.sqm);
        let qtyOfr = 0;
        let sqmOfr = 0;

        switch (savedInvoice.type) {
          case 'S':
          case 'SR':
            qtyOfr = qty;
            sqmOfr = sqm;
            break;
          case 'G':
            qtyOfr = qty;
            sqmOfr = sqm;
            qty = 0;
            sqm = 0;
            break;
          case 'RVR':
            qtyOfr = 0;
            sqmOfr = 0;
            break;
          default:
            qtyOfr = qty;
            sqmOfr = sqm;
        }

        const condition = (item as any).condition || 'Clean';
        const invoiceDate = new Date(savedInvoice.date);
        const year = invoiceDate.getFullYear();
        const month = String(invoiceDate.getMonth() + 1).padStart(2, '0'); // Add +1 because months are 0-based
        const dateReceived = null;

        let itemBatch = await this.itemBatchRepo.findOne({
          where: {
            itemVariant: { id: item.itemVariantId },
            condition,
            dateReceived,
          },
          relations: ['itemVariant'],
        });

        if (!itemBatch) {
          itemBatch = this.itemBatchRepo.create({
            itemVariant: { id: item.itemVariantId },
            condition,
            dateReceived,
            start: 0,
            in: 0,
            out: 0,
            balance: 0,
            startOFR: 0,
            inOFR: 0,
            outOFR: 0,
            balanceOFR: 0,
          });
          await this.itemBatchRepo.save(itemBatch);
        }

        const tx = this.inventoryTxRepo.create({
          itemVariantId: item.itemVariantId,
          itemBatchId: itemBatch.id, // ✅ Link batch here
          transactionType: 'purchase',
          quantity: qty,
          sqm: sqm,
          quantityofr: qtyOfr,
          sqmofr: sqmOfr,
          finalcost: Number((item as any).finalCost ?? 0),
          finalcostofr: Number((item as any).finalOFR ?? 0),
          purchaseInvoiceItemId: item.id,
          invoiceItemId: null,
          dateForEachInvoice: invoiceDate,
        });

        invTxs.push(tx);
      }

      await this.inventoryTxRepo.save(invTxs);
    }

    if (savedInvoice.status === 'Recieved') {
      for (const item of savedInvoice.items) {
        const condition = (item as any).condition || 'Clean';
        const invoiceDate = new Date(savedInvoice.date);
        const year = invoiceDate.getFullYear();
        const month = String(invoiceDate.getMonth() + 1).padStart(2, '0'); // Add +1 because months are 0-based
         const dateReceived = null;

        let itemBatch = await this.itemBatchRepo.findOne({
          where: {
            itemVariant: { id: item.itemVariantId },
            condition,
            dateReceived,
          },
          relations: ['itemVariant'],
        });

        if (!itemBatch) {
          itemBatch = this.itemBatchRepo.create({
            itemVariant: { id: item.itemVariantId },
            condition,
            dateReceived,
            start: 0,
            in: 0,
            out: 0,
            balance: 0,
            startOFR: 0,
            inOFR: 0,
            outOFR: 0,
            balanceOFR: 0,
          });
        }

        const sqm = Number(item.sqm);

        if (savedInvoice.type === 'S') {
          itemBatch.in = parseFloat(
            (Number(itemBatch.in ?? 0) + sqm).toFixed(4),
          );
          itemBatch.inOFR = parseFloat(
            (Number(itemBatch.inOFR ?? 0) + sqm).toFixed(4),
          );
        } else if (savedInvoice.type === 'G') {
          itemBatch.inOFR = parseFloat(
            (Number(itemBatch.inOFR ?? 0) + sqm).toFixed(4),
          );
        } else {
          itemBatch.in = parseFloat(
            (Number(itemBatch.in ?? 0) + sqm).toFixed(4),
          );
          itemBatch.inOFR = parseFloat(
            (Number(itemBatch.inOFR ?? 0) + sqm).toFixed(4),
          );
        }

        itemBatch.balance = parseFloat(
          (
            Number(itemBatch.start ?? 0) +
            Number(itemBatch.in ?? 0) -
            Number(itemBatch.out ?? 0)
          ).toFixed(4),
        );
        itemBatch.balanceOFR = parseFloat(
          (
            Number(itemBatch.startOFR ?? 0) +
            Number(itemBatch.inOFR ?? 0) -
            Number(itemBatch.outOFR ?? 0)
          ).toFixed(4),
        );

        const batchFields = ['in', 'inOFR', 'balance', 'balanceOFR'];
        for (const key of batchFields) {
          if (isNaN(itemBatch[key])) {
            console.error('❌ NaN detected in ItemBatch before save', {
              key,
              value: itemBatch[key],
              entity: itemBatch,
            });
            throw new Error(`❌ Cannot save NaN in ItemBatch.${key}`);
          }
        }

        await this.itemBatchRepo.save(itemBatch);
      }

      for (const item of savedInvoice.items) {
        const variant = await this.variantRepo.findOne({
          where: { id: item.itemVariantId },
          relations: ['batches'],
        });

        if (!variant) {
          console.log(`❌ ItemVariant not found for ID: ${item.itemVariantId}`);
          continue;
        }

        if (!variant.batches || variant.batches.length === 0) {
          console.log(`⚠️ No batches found for ItemVariant ID: ${variant.id}`);
        } else {
          console.log(
            `✅ Found ${variant.batches.length} batches for ItemVariant ID: ${variant.id}`,
          );
        }

        let totalStart = 0;
        let totalIn = 0;
        let totalOut = 0;
        let totalStartOFR = 0;
        let totalInOFR = 0;
        let totalOutOFR = 0;

        for (const batch of variant.batches) {
          const start = Number(batch.start);
          const inVal = Number(batch.in);
          const out = Number(batch.out);
          const startOFR = Number(batch.startOFR);
          const inOFR = Number(batch.inOFR);
          const outOFR = Number(batch.outOFR);

          console.log(`🔹 Batch ID ${batch.id}:`, {
            start,
            inVal,
            out,
            startOFR,
            inOFR,
            outOFR,
          });

          totalStart += start;
          totalIn += inVal;
          totalOut += out;
          totalStartOFR += startOFR;
          totalInOFR += inOFR;
          totalOutOFR += outOFR;
        }

        const totalBalance = parseFloat(
          (totalStart + totalIn - totalOut).toFixed(2),
        );
        const totalBalanceOFR = parseFloat(
          (totalStartOFR + totalInOFR - totalOutOFR).toFixed(2),
        );

        console.log(`📦 Updating ItemVariant ${variant.id} totals:`, {
          totalStart: totalStart.toFixed(2),
          totalIn: totalIn.toFixed(2),
          totalOut: totalOut.toFixed(2),
          totalBalance: totalBalance.toFixed(2),
          totalStartOFR: totalStartOFR.toFixed(2),
          totalInOFR: totalInOFR.toFixed(2),
          totalOutOFR: totalOutOFR.toFixed(2),
          totalBalanceOFR: totalBalanceOFR.toFixed(2),
        });

        variant.totalStart = parseFloat(totalStart.toFixed(2));
        variant.totalIn = parseFloat(totalIn.toFixed(2));
        variant.totalOut = parseFloat(totalOut.toFixed(2));
        variant.totalBalance = totalBalance;

        variant.totalStartOFR = parseFloat(totalStartOFR.toFixed(2));
        variant.totalInOFR = parseFloat(totalInOFR.toFixed(2));
        variant.totalOutOFR = parseFloat(totalOutOFR.toFixed(2));
        variant.totalBalanceOFR = totalBalanceOFR;

        await this.variantRepo.save(variant);
      }
    }

    // 3) if type is G, S or SR → build & save a JournalVoucher
    if (
      savedInvoice.status === 'Recieved' &&
      (savedInvoice.type === 'G' ||
        savedInvoice.type === 'S' ||
        savedInvoice.type === 'SR')
    ) {
      const expenseAcct = await this.accountRepo.findOne({
        where: { accountNumber: '6011' },
      });
      if (!expenseAcct) {
        throw new Error('GL account 6011 not found');
      }

      let normalTotal = 0;
      let ofrTotal = 0;

      if (savedInvoice.type === 'G') {
        for (const row of savedInvoice.items) {
          ofrTotal += Number(row.totalOFR);
        }
      } else if (savedInvoice.type === 'S') {
        for (const row of savedInvoice.items) {
          normalTotal += Number(row.totalAmount);
          ofrTotal += Number(row.totalAmount);
        }
      } else {
        for (const row of savedInvoice.items) {
          normalTotal += Number(row.totalAmount);
          ofrTotal += Number(row.totalOFR);
        }
      }

      const rate = Number(savedInvoice.exchangeRate);
      const normalLL = normalTotal * rate;
      const ofrLL = ofrTotal * rate;

      let prefix = 'PV';
      if (savedInvoice.type === 'G') {
        prefix = 'PVG';
      }

      const last = await this.journalVoucherRepo
        .find({
          where: { jvNumber: Like(`${prefix} - %`) },
          order: { jvNumber: 'DESC' },
          take: 1,
        })
        .then((arr) => arr[0]);

      const seq = last ? parseInt(last.jvNumber.split(' - ')[1], 10) + 1 : 1;
      const jvNumber = `${prefix} - ${String(seq).padStart(5, '0')}`;

      let hdrDr = 0,
        hdrDrUSD = 0,
        hdrDrLL = 0;
      let hdrDrOFR = 0,
        hdrDrUSDOFR = 0,
        hdrDrLLOFR = 0;
      let hdrCr = 0,
        hdrCrUSD = 0,
        hdrCrLL = 0;
      let hdrCrOFR = 0,
        hdrCrUSDOFR = 0,
        hdrCrLLOFR = 0;

      if (savedInvoice.type === 'G') {
        hdrDrOFR = ofrTotal;
        hdrDrUSDOFR = ofrTotal;
        hdrDrLLOFR = ofrLL;

        hdrCrOFR = ofrTotal;
        hdrCrUSDOFR = ofrTotal;
        hdrCrLLOFR = ofrLL;
      } else if (savedInvoice.type === 'S') {
        hdrDr = normalTotal;
        hdrDrUSD = normalTotal;
        hdrDrLL = normalLL;
        hdrDrOFR = normalTotal;
        hdrDrUSDOFR = normalTotal;
        hdrDrLLOFR = normalLL;

        hdrCr = normalTotal;
        hdrCrUSD = normalTotal;
        hdrCrLL = normalLL;
        hdrCrOFR = normalTotal;
        hdrCrUSDOFR = normalTotal;
        hdrCrLLOFR = normalLL;
      } else {
        hdrDr = normalTotal;
        hdrDrUSD = normalTotal;
        hdrDrLL = normalLL;
        hdrDrOFR = ofrTotal;
        hdrDrUSDOFR = ofrTotal;
        hdrDrLLOFR = ofrLL;

        hdrCr = normalTotal;
        hdrCrUSD = normalTotal;
        hdrCrLL = normalLL;
        hdrCrOFR = ofrTotal;
        hdrCrUSDOFR = ofrTotal;
        hdrCrLLOFR = ofrLL;
      }

      const debitLine = this.journalVoucherDetailRepo.create({
        accountId: expenseAcct.id,
        description:"فاتورة شراء",
        docNbr: jvNumber,
        dr: hdrDr,
        drUSD: hdrDrUSD,
        drLL: hdrDrLL,
        drOFR: hdrDrOFR,
        drUSDOFR: hdrDrUSDOFR,
        drLLOFR: hdrDrLLOFR,
        cr: 0,
        crUSD: 0,
        crLL: 0,
        crOFR: 0,
        crUSDOFR: 0,
        crLLOFR: 0,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      });

      const creditLine = this.journalVoucherDetailRepo.create({
        supplierId: savedInvoice.supplierId,
        description:"فاتورة شراء",
        docNbr: jvNumber,
        dr: 0,
        drUSD: 0,
        drLL: 0,
        drOFR: 0,
        drUSDOFR: 0,
        drLLOFR: 0,
        cr: hdrCr,
        crUSD: hdrCrUSD,
        crLL: hdrCrLL,
        crOFR: hdrCrOFR,
        crUSDOFR: hdrCrUSDOFR,
        crLLOFR: hdrCrLLOFR,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      });
      const extraJVDetails: JournalVoucherDetail[] = [];

      if (data.unitPriceRows?.length) {
        for (const row of data.unitPriceRows) {
          const value = Number(row.value || 0);
          const valueOFR = Number(row.valueOFR || 0);
          const valueLL = value * savedInvoice.exchangeRate;
          const valueOFRLL = valueOFR * savedInvoice.exchangeRate;

          let dr = 0,
            drUSD = 0,
            drLL = 0,
            drOFR = 0,
            drUSDOFR = 0,
            drLLOFR = 0;

          let cr = 0,
            crUSD = 0,
            crLL = 0,
            crOFR = 0,
            crUSDOFR = 0,
            crLLOFR = 0;

          if (savedInvoice.type === 'G') {
            drOFR = valueOFR;
            drUSDOFR = valueOFR;
            drLLOFR = valueOFRLL;

            crOFR = valueOFR;
            crUSDOFR = valueOFR;
            crLLOFR = valueOFRLL;
          } else if (savedInvoice.type === 'S') {
            dr = value;
            drUSD = value;
            drLL = valueLL;
            drOFR = value;
            drUSDOFR = value;
            drLLOFR = valueLL;

            cr = value;
            crUSD = value;
            crLL = valueLL;
            crOFR = value;
            crUSDOFR = value;
            crLLOFR = valueLL;
          } else if (savedInvoice.type === 'SR') {
            dr = value;
            drUSD = value;
            drLL = valueLL;
            drOFR = valueOFR;
            drUSDOFR = valueOFR;
            drLLOFR = valueOFRLL;

            cr = value;
            crUSD = value;
            crLL = valueLL;
            crOFR = valueOFR;
            crUSDOFR = valueOFR;
            crLLOFR = valueOFRLL;
          }

          const drLine = this.journalVoucherDetailRepo.create({
            accountId: row.accountId ?? null,
             description:"فاتورة شراء",
            docNbr: jvNumber,
            dr,
            drUSD,
            drLL,
            drOFR,
            drUSDOFR,
            drLLOFR,
            cr: 0,
            crUSD: 0,
            crLL: 0,
            crOFR: 0,
            crUSDOFR: 0,
            crLLOFR: 0,
            exchangeRateAcc: null,
            exchangeRateUSD: null,
          });

          const crLine = this.journalVoucherDetailRepo.create({
            supplierId: row.supplierId ?? null,
             description:"فاتورة شراء",
            docNbr: jvNumber,
            dr: 0,
            drUSD: 0,
            drLL: 0,
            drOFR: 0,
            drUSDOFR: 0,
            drLLOFR: 0,
            cr,
            crUSD,
            crLL,
            crOFR,
            crUSDOFR,
            crLLOFR,
            exchangeRateAcc: null,
            exchangeRateUSD: null,
          });

          extraJVDetails.push(drLine, crLine);
        }
      }

      const jv = this.journalVoucherRepo.create({
        jvNumber,
        purchaseInvoiceId: savedInvoice.id,
        date: savedInvoice.jvDate,
        jvType: savedInvoice.type,
        totalDr: hdrDr,
        totalDrUSD: hdrDrUSD,
        totalDrLL: hdrDrLL,
        totalDrOFR: hdrDrOFR,
        totalDrUSDOFR: hdrDrUSDOFR,
        totalDrLLOFR: hdrDrLLOFR,
        totalCr: hdrCr,
        totalCrUSD: hdrCrUSD,
        totalCrLL: hdrCrLL,
        totalCrOFR: hdrCrOFR,
        totalCrUSDOFR: hdrCrUSDOFR,
        totalCrLLOFR: hdrCrLLOFR,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
        details: [debitLine, creditLine, ...extraJVDetails],
      });

      await this.journalVoucherRepo.save(jv);
    }

    if (data.unitPriceRows?.length) {
      const normalized = data.unitPriceRows.map((r) => {
        const v = Number(r.value);
        const o = Number(r.valueOFR);
        const ex = Number(r.valueExch);
        const eo = Number(r.valueExchOFR);
        return {
          ...r,
          valueOFR: v > 0 && o === 0 ? v : o,
          valueExchOFR: ex > 0 && eo === 0 ? ex : eo,
        };
      });

      const rowsToSave = normalized.map((row) =>
        this.rowRepo.create({
          invoice: { id: savedInvoice.id },
          invoiceId: savedInvoice.id,
          purchaseInvoiceSettingId: row.purchaseInvoiceSettingId ?? null,
          chargeName: row.chargeName,
          chargeType: row.chargeType,
          value: row.value,
          valueOFR: row.valueOFR,
          currency: row.currency,
          valueExch: row.valueExch,
          valueExchOFR: row.valueExchOFR,
          addToItemCost: row.addToItemCost,
          invoiceNbTax: row.invoiceNbTax,
          supplierId: row.supplierId ?? null,
          accountId: row.accountId ?? null,
          shipping: row.shipping,
        }),
      );

      await this.rowRepo.save(rowsToSave);
    }
// …after your inventory transactions and variant‐totals logic…
const clampPrevQty = (raw: any, label: string, ctx: any = {}) => {
  let n = Number(raw);
  if (!Number.isFinite(n)) n = 0;

  if (n < 0) {
    console.warn(`⚠️ ${label} was negative → clamped to 0`, { raw, n, ...ctx });
    return 0;
  }
  return n;
};




if (savedInvoice.status === "Recieved") {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0);

  const items = savedInvoice.items ?? [];
  const currPiiIds = items.map((i) => i.id).filter((x) => Number.isFinite(Number(x)));

  // --- preload variant -> descId for grouping ---
  const variantIdsInInvoice = Array.from(
    new Set(items.map((i) => Number(i.itemVariantId)).filter((n) => Number.isFinite(n) && n > 0)),
  );

  const variantRows = variantIdsInInvoice.length
    ? await this.variantRepo.find({
        where: { id: In(variantIdsInInvoice) },
        select: ["id", "itemNameDescriptionId"],
      })
    : [];

  const variantToDesc = new Map<number, number | null>(
    variantRows.map((v) => [Number(v.id), v.itemNameDescriptionId ?? null]),
  );

  const itemsByDesc = new Map<number, PurchaseInvoiceItem[]>();
  for (const it of items) {
    const vid = Number(it.itemVariantId);
    const descId = variantToDesc.get(vid);
    if (!descId) continue;
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(it);
  }
  const descIds = Array.from(itemsByDesc.keys());

  // ------------------------------------------------------------------
  // A) PER-VARIANT: averageCost (OFR) + averageCostVM (VM)
  //    prevQty comes from inventory_transactions SUM before dayStart
  //    prevAvg comes from last PO if exists, else InventoryCount fallback
  // ------------------------------------------------------------------
  for (const it of items) {
    const vid = Number(it.itemVariantId);
    if (!Number.isFinite(vid) || vid <= 0) continue;

    // OFR chain (uses sqmofr)
    const prevOfr = await resolvePrevVariant(
      this.itemRepo,
      this.inventoryTxRepo,
      this.invTransRepo.manager,
      this.variantRepo,
      vid,
      "OFR",
      "averageCost",
      dayStart,
      currPiiIds,
    );

    // VM chain (uses sqm)
    const prevVm = await resolvePrevVariant(
      this.itemRepo,
      this.inventoryTxRepo,
      this.invTransRepo.manager,
      this.variantRepo,
      vid,
      "VM",
      "averageCostVM",
      dayStart,
      currPiiIds,
    );

    // current PO qty & cost
    const poQtyOfr = getItemQty(it, "OFR");      // sqmOfr
    const poCostOfr = getItemCost(it, "OFR");    // finalOFR
    const poQtyVm = getItemQty(it, "VM");        // sqm
    const poCostVm = getItemCost(it, "VM");      // finalCost

    // new avg OFR
    const totalOfr = prevOfr.prevQty + poQtyOfr;
    const newAvgOfr =
      totalOfr > 0
        ? (prevOfr.prevAvg * prevOfr.prevQty + poCostOfr * poQtyOfr) / totalOfr
        : prevOfr.prevAvg;

    // new avg VM
    const totalVm = prevVm.prevQty + poQtyVm;
    const newAvgVm =
      totalVm > 0
        ? (prevVm.prevAvg * prevVm.prevQty + poCostVm * poQtyVm) / totalVm
        : prevVm.prevAvg;

    // write into PurchaseInvoiceItem
    await this.itemRepo.update(it.id, {
      previousQuantity: prevOfr.prevQty,
      previousAverageCost: prevOfr.prevAvg,
      averageCost: newAvgOfr,

      previousQuantityVM: prevVm.prevQty,
      previousAverageCostVM: prevVm.prevAvg,
      averageCostVM: newAvgVm,
    });

    // mirror into ItemVariant
    await this.variantRepo.update(vid, {
      averageCost: newAvgOfr,
      lastCost: poCostOfr,

      averageCostVM: newAvgVm,
      lastCostVM: poCostVm,
    });
  }

  // ------------------------------------------------------------------
  // B) PER-DESCRIPTION: averageCostC (OFR) + averageCostCVM (VM)
  //    prevQtyC     = SUM(sqmofr) for ALL variants under descId
  //    prevQtyCVM   = SUM(sqm)    for ALL variants under descId
  //    prevAvgC     = last PO avgCostC if exists else InventoryCount fallback
  //    prevAvgCVM   = last PO avgCostCVM if exists else InventoryCount fallback
  // ------------------------------------------------------------------
  for (const descId of descIds) {
    const rows = itemsByDesc.get(descId) ?? [];
    if (!rows.length) continue;

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId } as any,
        select: ["id"],
      })
    )
      .map((v) => Number(v.id))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!variantIdsForDesc.length) continue;

    // ---- prevQtyC (OFR) from inventory tx SUM(sqmofr) ----
    const prevQtyC = await sumTxQty(
      this.inventoryTxRepo,
      variantIdsForDesc,
      "OFR",
      dayStart,
      currPiiIds,
    );

    // ---- prevAvgC (OFR) from last PO, else InventoryCount(finalCostOfr) ----
    const prevCRow = await this.itemRepo
      .createQueryBuilder("pii")
      .innerJoin("pii.invoice", "inv")
      .innerJoin("pii.itemVariant", "iv")
      .where("inv.status = :st", { st: "Recieved" })
      .andWhere("inv.date < :cut", { cut: dayStart })
      .andWhere("iv.itemNameDescriptionId = :descId", { descId })
      .andWhere("pii.averageCostC IS NOT NULL")
      .orderBy("inv.date", "DESC")
      .addOrderBy("pii.id", "DESC")
      .select(["pii.averageCostC AS avg"])
      .getRawOne<{ avg?: string | number | null }>();

const fbC = await openingsWeightedAvg(this.invTransRepo.manager, variantIdsForDesc, "OFR");
const prevAvgC =
  prevCRow?.avg != null ? num(prevCRow.avg, 0) : fbC.avg;


    // ---- current invoice (desc group) OFR weighted PO cost ----
    const poQtyC = rows.reduce((s, r) => s + getItemQty(r, "OFR"), 0);
    const poWsumC = rows.reduce(
      (s, r) => s + getItemQty(r, "OFR") * getItemCost(r, "OFR"),
      0,
    );
    const poCostC = poQtyC > 0 ? poWsumC / poQtyC : 0;

    const totalC = prevQtyC + poQtyC;
    const newAvgC =
      totalC > 0 ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalC : prevAvgC;

    // ---- prevQtyCVM (VM) from inventory tx SUM(sqm) ----
    const prevQtyCVM = await sumTxQty(
      this.inventoryTxRepo,
      variantIdsForDesc,
      "VM",
      dayStart,
      currPiiIds,
    );

    // ---- prevAvgCVM (VM) from last PO, else InventoryCount(finalCost) ----
    const prevCvmRow = await this.itemRepo
      .createQueryBuilder("pii")
      .innerJoin("pii.invoice", "inv")
      .innerJoin("pii.itemVariant", "iv")
      .where("inv.status = :st", { st: "Recieved" })
      .andWhere("inv.date < :cut", { cut: dayStart })
      .andWhere("iv.itemNameDescriptionId = :descId", { descId })
      .andWhere("pii.averageCostCVM IS NOT NULL")
      .orderBy("inv.date", "DESC")
      .addOrderBy("pii.id", "DESC")
      .select(["pii.averageCostCVM AS avg"])
      .getRawOne<{ avg?: string | number | null }>();

const fbCVM = await openingsWeightedAvg(this.invTransRepo.manager, variantIdsForDesc, "VM");
const prevAvgCVM =
  prevCvmRow?.avg != null ? num(prevCvmRow.avg, 0) : fbCVM.avg;


    // ---- current invoice (desc group) VM weighted PO cost ----
    const poQtyCVM = rows.reduce((s, r) => s + getItemQty(r, "VM"), 0);
    const poWsumCVM = rows.reduce(
      (s, r) => s + getItemQty(r, "VM") * getItemCost(r, "VM"),
      0,
    );
    const poCostCVM = poQtyCVM > 0 ? poWsumCVM / poQtyCVM : 0;

    const totalCVM = prevQtyCVM + poQtyCVM;
    const newAvgCVM =
      totalCVM > 0
        ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalCVM
        : prevAvgCVM;

    // write C + CVM to all rows of this desc in THIS invoice
    for (const r of rows) {
      await this.itemRepo.update(r.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,

        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      });
    }

    // mirror into ItemNameDescription
    const lastRow = rows[rows.length - 1] as any;
    await this.descRepo.update(descId, {
      averageCostC: newAvgC,
      averageCostCVM: newAvgCVM,
      lastCostC: getItemCost(lastRow, "OFR"),
      lastCostCVM: getItemCost(lastRow, "VM"),
    });
  }
}


   // 🔁 Re-apply purchase-side averages for THIS invoice
  await this.applyPurchaseCostsForInvoice(savedInvoice.id);

  // 🔁 Build affected variant list (for this invoice)
  const affected = Array.from(
    new Set(
      (savedInvoice.items ?? [])
        .map((it: any) => Number(it.itemVariantId))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  );

  // 1) Recompute purchase chain for later POs of these variants
  await this.recomputePurchaseChainFrom(new Date(savedInvoice.date), affected);

  // 2) Recompute sales invoice items that use these variants
  await this.recomputeSalesCostsFrom(new Date(savedInvoice.date), affected);
}

  

  

  async findAll() {
    return this.invoiceRepo.find({
      relations: [
        'supplier',
        'items',
        'items.itemVariant',
        'unitPriceRows',
        'unitPriceRows.purchaseInvoiceSetting',
      ],
    });
  }

  async findOne(id: number) {
    return this.invoiceRepo.findOne({
      where: { id },
      relations: [
        'supplier',
        'items',
        'items.itemVariant',
        'items.itemVariant.thickness',
        'items.itemVariant.thickness.item',
        'unitPriceRows',
        'unitPriceRows.supplier',
        'unitPriceRows.supplier.account',
        'unitPriceRows.purchaseInvoiceSetting',
      ],
    });
  }

  async findMinimalInvoices() {
    return this.invoiceRepo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.supplier', 'supplier')
      .select([
        'invoice.id',
        'invoice.invoiceNumber',
        'invoice.date',
        'invoice.grandAmount',
        'supplier.supplierName',
      ])
      .orderBy('invoice.id', 'DESC')
      .getMany();
  }
  // PurchaseInvoiceService.update method





private async rebuildInventoryForPurchaseInvoice(
  savedInvoice: PurchaseInvoice,
  extraBatchIds: number[] = [],   // ✅ batches touched by OLD items / OLD txs
): Promise<void> {
  const PREFIX = '[rebuildInventoryForPurchaseInvoice]';

  if (!savedInvoice) return;

  const isPosted = savedInvoice.status === 'Recieved';

  const items = savedInvoice.items ?? [];
  // if we have no items *and* no extra batches to fix, nothing to do
  if (!items.length && !extraBatchIds.length) return;

  const invoiceDate = new Date(savedInvoice.date);

  console.log(PREFIX, 'Start rebuild for invoice:', {
    id: savedInvoice.id,
    type: savedInvoice.type,
    status: savedInvoice.status,
    date: savedInvoice.jvDate,
    invoiceDate,
    itemsCount: items.length,
    extraBatchIds,
  });

  const itemIds = items.map((it: any) => it.id);
  console.log(PREFIX, 'Invoice item IDs:', itemIds);

  // ─────────────────────────────────────────────
  // 0) Remove old inventory tx rows for this invoice
  //    but remember which batchId each item used
  // ─────────────────────────────────────────────
  const existingTxs = itemIds.length
    ? await this.inventoryTxRepo.find({
        where: { purchaseInvoiceItemId: In(itemIds) },
      })
    : [];
  console.log(PREFIX, 'Existing inventory txs for this invoice:', {
    count: existingTxs.length,
  });

  const batchIdByItemId = new Map<number, number>();
  for (const tx of existingTxs) {
    if (tx.purchaseInvoiceItemId && tx.itemBatchId) {
      batchIdByItemId.set(tx.purchaseInvoiceItemId, tx.itemBatchId);
    }
  }
  console.log(
    PREFIX,
    'batchIdByItemId map:',
    Array.from(batchIdByItemId.entries()),
  );

  if (existingTxs.length) {
    await this.inventoryTxRepo.delete({
      purchaseInvoiceItemId: In(itemIds),
    });
  }

  const invTxs: InventoryTransaction[] = [];

  // ─────────────────────────────────────────────
  // 1) (Re)create inventory_transaction rows
  //    ONLY if invoice is posted (status = Recieved)
  // ─────────────────────────────────────────────
  if (isPosted && items.length) {
    for (const item of items) {
      const itemId = (item as any).id;
      let existingBatchId = batchIdByItemId.get(itemId) ?? null;

      console.log(PREFIX, '--- Item loop start ---', {
        purchaseInvoiceItemId: itemId,
        itemVariantId: item.itemVariantId,
        existingBatchId,
        rawSqm: (item as any).sqm,
        rawSqmOfr: (item as any).sqmofr,
        rawQty: item.quantity,
      });

      // If we had a batch before, reuse it; if not, try to find one
      if (!existingBatchId) {
        const condition = (item as any).condition || 'Clean';

        const fallbackBatch = await this.itemBatchRepo.findOne({
          where: {
            itemVariant: { id: item.itemVariantId },
            condition,
            dateReceived: null, // you are storing dateReceived as NULL
          },
        });

        if (fallbackBatch) {
          existingBatchId = fallbackBatch.id;
          console.log(PREFIX, 'Found fallback batch by variant+condition:', {
            purchaseInvoiceItemId: itemId,
            variantId: item.itemVariantId,
            condition,
            batchId: fallbackBatch.id,
          });
        } else {
          console.warn(
            PREFIX,
            'No existing tx batch and no fallback batch found. Skipping item.',
            { purchaseInvoiceItemId: itemId, variantId: item.itemVariantId },
          );
          continue;
        }
      }

      const sqft = Number((item as any).sqm ?? item.sqm ?? 0); // VM
      const sqftOFR = Number((item as any).sqmofr ?? sqft ?? 0); // OFR

      let qty = Number(item.quantity ?? 0);
      let qtyOfr = qty;
      let sqm = sqft;
      let sqmOfr = sqftOFR;

      console.log(PREFIX, 'Before type switch:', {
        qty,
        qtyOfr,
        sqm,
        sqmOfr,
        invoiceType: savedInvoice.type,
      });

      switch (savedInvoice.type) {
        case 'S':
        case 'SR':
          // normal PO → everything goes as OFR & VM
          qtyOfr = qty;
          sqmOfr = sqm;
          break;

        case 'G':
          // G invoice → OFR only
          qtyOfr = qty;
          sqmOfr = sqm;
          qty = 0;
          sqm = 0;
          console.log(PREFIX, 'Type G logic applied');
          break;

        case 'RVR':
          // RVR → VM only
          qtyOfr = 0;
          sqmOfr = 0;
          break;
      }

      console.log(PREFIX, 'After type switch:', {
        qty,
        qtyOfr,
        sqm,
        sqmOfr,
      });

      const tx = this.inventoryTxRepo.create({
        itemVariantId: item.itemVariantId,
        itemBatchId: existingBatchId,
        transactionType: 'purchase',
        quantity: qty,
        sqm: sqm,
        quantityofr: qtyOfr,
        sqmofr: sqmOfr,
        finalcost: Number((item as any).finalCost ?? 0),
        finalcostofr: Number((item as any).finalOFR ?? 0),
        purchaseInvoiceItemId: itemId,
        invoiceItemId: null,
        dateForEachInvoice: invoiceDate,
      });

      console.log(PREFIX, 'Created inventory_tx (not saved yet):', {
        itemVariantId: tx.itemVariantId,
        itemBatchId: tx.itemBatchId,
        quantity: tx.quantity,
        sqm: tx.sqm,
        quantityofr: tx.quantityofr,
        sqmofr: tx.sqmofr,
        finalcost: tx.finalcost,
        finalcostofr: tx.finalcostofr,
        purchaseInvoiceItemId: tx.purchaseInvoiceItemId,
      });

      invTxs.push(tx);
      console.log(PREFIX, '--- Item loop end ---');
    }

    if (invTxs.length) {
      console.log(
        PREFIX,
        'Saving new inventory transactions:',
        invTxs.length,
      );
      await this.inventoryTxRepo.save(invTxs);
    }
  }

  // ─────────────────────────────────────────────
  // 2) Recalculate batch totals FROM inventory_transaction
  //    ❗ ONLY FROM PURCHASE TXs (not start counts etc.)
  //    We include:
  //      - batches touched by NEW txs (invTxs)
  //      - batches passed in extraBatchIds (from OLD items / OLD status)
  // ─────────────────────────────────────────────
  const affectedBatchIds = Array.from(
    new Set(
      [
        ...(invTxs
          .map((tx) => tx.itemBatchId)
          .filter((id) => id != null) as number[]),
        ...extraBatchIds,
      ].map((id) => Number(id)),
    ),
  );
  console.log(PREFIX, 'Affected batch IDs (with extras):', affectedBatchIds);

  // We’ll collect variantIds from:
  //   - current invoice items
  //   - variants owning affected batches (important for deleted items)
  const variantIdSet = new Set<number>(
    items
      .map((it: any) => Number(it.itemVariantId))
      .filter((n) => Number.isFinite(n) && n > 0),
  );

  for (const batchId of affectedBatchIds) {
    const batch = await this.itemBatchRepo.findOne({
      where: { id: batchId },
      relations: ['itemVariant'],
    });
    if (!batch) {
      console.warn(PREFIX, 'Batch not found when recomputing:', { batchId });
      continue;
    }

    const variantIdFromBatch =
      (batch as any).itemVariantId ??
      (batch.itemVariant ? Number(batch.itemVariant.id) : null);

    if (Number.isFinite(variantIdFromBatch) && variantIdFromBatch! > 0) {
      variantIdSet.add(Number(variantIdFromBatch));
    }

    // debug: list all tx for this batch
    const allTxForBatch = await this.inventoryTxRepo.find({
      where: { itemBatchId: batchId },
    });
    console.log(PREFIX, 'All tx for this batch:', {
      batchId,
      txs: allTxForBatch.map((t) => ({
        id: t.id,
        type: t.transactionType,
        sqm: t.sqm,
        sqmofr: t.sqmofr,
        purchaseInvoiceItemId: t.purchaseInvoiceItemId,
      })),
    });

    // aggregate ONLY purchases -> this feeds "in" / "inOFR"
    const agg = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.sqm), 0)', 'sumSqm')
      .addSelect('COALESCE(SUM(tx.sqmofr), 0)', 'sumSqmOfr')
      .where('tx.itemBatchId = :batchId', { batchId })
      .andWhere('tx.transactionType = :txType', { txType: 'purchase' })
      .getRawOne<{ sumSqm: string; sumSqmOfr: string }>();

    const inSqm = Number(agg?.sumSqm ?? 0);
    const inSqmOFR = Number(agg?.sumSqmOfr ?? 0);

    console.log(PREFIX, 'Batch aggregates from PURCHASE tx only:', {
      batchId,
      sumSqm: agg?.sumSqm,
      sumSqmOfr: agg?.sumSqmOfr,
      inSqm,
      inSqmOFR,
      oldIn: batch.in,
      oldInOFR: batch.inOFR,
    });

    batch.in = parseFloat(inSqm.toFixed(4));
    batch.inOFR = parseFloat(inSqmOFR.toFixed(4));

    batch.balance = parseFloat(
      (
        Number(batch.start ?? 0) +
        Number(batch.in ?? 0) -
        Number(batch.out ?? 0)
      ).toFixed(4),
    );
    batch.balanceOFR = parseFloat(
      (
        Number(batch.startOFR ?? 0) +
        Number(batch.inOFR ?? 0) -
        Number(batch.outOFR ?? 0)
      ).toFixed(4),
    );

    console.log(PREFIX, 'Batch after recompute:', {
      batchId,
      start: batch.start,
      in: batch.in,
      out: batch.out,
      balance: batch.balance,
      startOFR: batch.startOFR,
      inOFR: batch.inOFR,
      outOFR: batch.outOFR,
      balanceOFR: batch.balanceOFR,
    });

    await this.itemBatchRepo.save(batch);
  }

  // ─────────────────────────────────────────────
  // 3) Recalculate ItemVariant totals from batches
  //    (for variants in current items + variants owning affected batches)
  // ─────────────────────────────────────────────
  const affectedVariantIds = Array.from(variantIdSet);
  console.log(PREFIX, 'Affected variant IDs (final):', affectedVariantIds);

  if (!affectedVariantIds.length) return;

  for (const variantId of affectedVariantIds) {
    const variant = await this.variantRepo.findOne({
      where: { id: variantId },
      relations: ['batches'],
    });

    if (!variant) {
      console.warn(PREFIX, 'Variant not found when recomputing totals:', {
        variantId,
      });
      continue;
    }

    console.log(
      PREFIX,
      'Recomputing variant totals from batches:',
      variantId,
      'batches:',
      variant.batches?.length ?? 0,
    );

    let totalStart = 0;
    let totalIn = 0;
    let totalOut = 0;
    let totalStartOFR = 0;
    let totalInOFR = 0;
    let totalOutOFR = 0;

    for (const batch of variant.batches || []) {
      totalStart += Number(batch.start ?? 0);
      totalIn += Number(batch.in ?? 0);
      totalOut += Number(batch.out ?? 0);
      totalStartOFR += Number(batch.startOFR ?? 0);
      totalInOFR += Number(batch.inOFR ?? 0);
      totalOutOFR += Number(batch.outOFR ?? 0);
    }

    const totalBalance = parseFloat(
      (totalStart + totalIn - totalOut).toFixed(4),
    );
    const totalBalanceOFR = parseFloat(
      (totalStartOFR + totalInOFR - totalOutOFR).toFixed(4),
    );

    variant.totalStart = parseFloat(totalStart.toFixed(4));
    variant.totalIn = parseFloat(totalIn.toFixed(4));
    variant.totalOut = parseFloat(totalOut.toFixed(4));
    variant.totalBalance = totalBalance;

    variant.totalStartOFR = parseFloat(totalStartOFR.toFixed(4));
    variant.totalInOFR = parseFloat(totalInOFR.toFixed(4));
    variant.totalOutOFR = parseFloat(totalOutOFR.toFixed(4));
    variant.totalBalanceOFR = totalBalanceOFR;

    console.log(PREFIX, 'Variant totals after recompute:', {
      variantId,
      totalStart: variant.totalStart,
      totalIn: variant.totalIn,
      totalOut: variant.totalOut,
      totalBalance: variant.totalBalance,
      totalStartOFR: variant.totalStartOFR,
      totalInOFR: variant.totalInOFR,
      totalOutOFR: variant.totalOutOFR,
      totalBalanceOFR: variant.totalBalanceOFR,
    });

    await this.variantRepo.save(variant);
  }
}




private async getPurchaseAvgCostsAsOf(itemVariantId: number, asOfDate: Date) {
  const reqId = `POCOST:${itemVariantId}:${asOfDate.toISOString().slice(0, 10)}:${Date.now()}`;

  // inclusive same-day
  const cut = new Date(asOfDate);
  cut.setHours(23, 59, 59, 999);

  console.log(`\n🔍 [${reqId}] getPurchaseAvgCostsAsOf START`, {
    itemVariantId,
    asOfDateISO: asOfDate.toISOString(),
    cutISO: cut.toISOString(),
    poTypes: ['S', 'G', 'SR'],
  });

  const qb = this.itemRepo
    .createQueryBuilder('pii')
    .innerJoin('pii.invoice', 'pi')
    .where('pii.itemVariantId = :vid', { vid: itemVariantId })
    .andWhere('pi.status = :st', { st: 'Recieved' })
    .andWhere('pi.type IN (:...types)', { types: ['S', 'G', 'SR'] })
    .andWhere('pi.date <= :cut', { cut })
    .orderBy('pi.date', 'DESC')
    .addOrderBy('pi.id', 'DESC')
    .addOrderBy('pii.id', 'DESC')
    .select([
      'pii.averageCost AS averageCost',
      'pii.averageCostC AS averageCostC',
      'pii.averageCostVM AS averageCostVM',
      'pii.averageCostCVM AS averageCostCVM',
      'pi.id AS piId',
      'pi.date AS piDate',
      'pi.type AS piType',
      'pii.id AS piiId',
    ]);

  try {
    // @ts-ignore
    console.log(`🧠 [${reqId}] SQL:`, qb.getSql?.() ?? '(sql not available)');
    // @ts-ignore
    console.log(`🧠 [${reqId}] Params:`, qb.getParameters?.() ?? '(params not available)');
  } catch {}

  const raw = await qb.getRawOne<{
    averageCost?: string | number | null;
    averageCostC?: string | number | null;
    averageCostVM?: string | number | null;
    averageCostCVM?: string | number | null;
    piId?: number;
    piDate?: Date;
    piType?: string;
    piiId?: number;
  }>();

  console.log(`📄 [${reqId}] Raw latest purchase row`, raw ?? null);

  const result = {
    averageCost: raw?.averageCost != null ? Number(raw.averageCost) : null,
    averageCostC: raw?.averageCostC != null ? Number(raw.averageCostC) : null,
    averageCostVM: raw?.averageCostVM != null ? Number(raw.averageCostVM) : null,
    averageCostCVM: raw?.averageCostCVM != null ? Number(raw.averageCostCVM) : null,
  };

  console.log(`✅ [${reqId}] getPurchaseAvgCostsAsOf END`, {
    pickedFrom: raw
      ? { piId: raw.piId, piDate: raw.piDate, piType: raw.piType, piiId: raw.piiId }
      : null,
    result,
  });

  return result;
}
  

private async createOrRebuildJVForPurchaseInvoice(
  invoice: PurchaseInvoice,
  items: PurchaseInvoiceItem[],
  unitPriceRows: any[] | undefined,
) {
  if (
    invoice.status !== 'Recieved' ||
    !['G', 'S', 'SR'].includes(invoice.type as any)
  ) {
    return;
  }

  const expenseAcct = await this.accountRepo.findOne({
    where: { accountNumber: '6011' },
  });
  if (!expenseAcct) {
    throw new Error('GL account 6011 not found');
  }

  let normalTotal = 0;
  let ofrTotal = 0;

  if (invoice.type === 'G') {
    for (const row of items) {
      ofrTotal += Number(row.totalOFR);
    }
  } else if (invoice.type === 'S') {
    for (const row of items) {
      normalTotal += Number(row.totalAmount);
      ofrTotal += Number(row.totalAmount);
    }
  } else {
    for (const row of items) {
      normalTotal += Number(row.totalAmount);
      ofrTotal += Number(row.totalOFR);
    }
  }

  const rate = Number(invoice.exchangeRate);
  const normalLL = normalTotal * rate;
  const ofrLL = ofrTotal * rate;

  let prefix = 'PV';
  if (invoice.type === 'G') prefix = 'PVG';

  const last = await this.journalVoucherRepo
    .find({
      where: { jvNumber: Like(`${prefix} - %`) },
      order: { jvNumber: 'DESC' },
      take: 1,
    })
    .then((arr) => arr[0]);

  const seq = last ? parseInt(last.jvNumber.split(' - ')[1], 10) + 1 : 1;
  const jvNumber = `${prefix} - ${String(seq).padStart(5, '0')}`;

  let hdrDr = 0,
    hdrDrUSD = 0,
    hdrDrLL = 0;
  let hdrDrOFR = 0,
    hdrDrUSDOFR = 0,
    hdrDrLLOFR = 0;
  let hdrCr = 0,
    hdrCrUSD = 0,
    hdrCrLL = 0;
  let hdrCrOFR = 0,
    hdrCrUSDOFR = 0,
    hdrCrLLOFR = 0;

  if (invoice.type === 'G') {
    hdrDrOFR = ofrTotal;
    hdrDrUSDOFR = ofrTotal;
    hdrDrLLOFR = ofrLL;

    hdrCrOFR = ofrTotal;
    hdrCrUSDOFR = ofrTotal;
    hdrCrLLOFR = ofrLL;
  } else if (invoice.type === 'S') {
    hdrDr = normalTotal;
    hdrDrUSD = normalTotal;
    hdrDrLL = normalLL;
    hdrDrOFR = normalTotal;
    hdrDrUSDOFR = normalTotal;
    hdrDrLLOFR = normalLL;

    hdrCr = normalTotal;
    hdrCrUSD = normalTotal;
    hdrCrLL = normalLL;
    hdrCrOFR = normalTotal;
    hdrCrUSDOFR = normalTotal;
    hdrCrLLOFR = normalLL;
  } else {
    hdrDr = normalTotal;
    hdrDrUSD = normalTotal;
    hdrDrLL = normalLL;
    hdrDrOFR = ofrTotal;
    hdrDrUSDOFR = ofrTotal;
    hdrDrLLOFR = ofrLL;

    hdrCr = normalTotal;
    hdrCrUSD = normalTotal;
    hdrCrLL = normalLL;
    hdrCrOFR = ofrTotal;
    hdrCrUSDOFR = ofrTotal;
    hdrCrLLOFR = ofrLL;
  }

  const debitLine = this.journalVoucherDetailRepo.create({
    accountId: expenseAcct.id,
    description: 'فاتورة شراء',
    docNbr: jvNumber, // ✅ PV/JV number in docNbr

    dr: hdrDr,
    drUSD: hdrDrUSD,
    drLL: hdrDrLL,
    drOFR: hdrDrOFR,
    drUSDOFR: hdrDrUSDOFR,
    drLLOFR: hdrDrLLOFR,
    cr: 0,
    crUSD: 0,
    crLL: 0,
    crOFR: 0,
    crUSDOFR: 0,
    crLLOFR: 0,
    exchangeRateAcc: null,
    exchangeRateUSD: null,
  });

  const creditLine = this.journalVoucherDetailRepo.create({
    supplierId: invoice.supplierId,
    description: 'فاتورة شراء',
    docNbr: jvNumber, // ✅ here too

    dr: 0,
    drUSD: 0,
    drLL: 0,
    drOFR: 0,
    drUSDOFR: 0,
    drLLOFR: 0,
    cr: hdrCr,
    crUSD: hdrCrUSD,
    crLL: hdrCrLL,
    crOFR: hdrCrOFR,
    crUSDOFR: hdrCrUSDOFR,
    crLLOFR: hdrCrLLOFR,
    exchangeRateAcc: null,
    exchangeRateUSD: null,
  });

  const extraJVDetails: JournalVoucherDetail[] = [];

  if (unitPriceRows?.length) {
    for (const row of unitPriceRows) {
      const value = Number(row.value || 0);
      const valueOFR = Number(row.valueOFR || 0);
      const valueLL = value * invoice.exchangeRate;
      const valueOFRLL = valueOFR * invoice.exchangeRate;

      let dr = 0,
        drUSD = 0,
        drLL = 0,
        drOFR = 0,
        drUSDOFR = 0,
        drLLOFR = 0;

      let cr = 0,
        crUSD = 0,
        crLL = 0,
        crOFR = 0,
        crUSDOFR = 0,
        crLLOFR = 0;

      if (invoice.type === 'G') {
        drOFR = valueOFR;
        drUSDOFR = valueOFR;
        drLLOFR = valueOFRLL;

        crOFR = valueOFR;
        crUSDOFR = valueOFR;
        crLLOFR = valueOFRLL;
      } else if (invoice.type === 'S') {
        dr = value;
        drUSD = value;
        drLL = valueLL;
        drOFR = value;
        drUSDOFR = value;
        drLLOFR = valueLL;

        cr = value;
        crUSD = value;
        crLL = valueLL;
        crOFR = value;
        crUSDOFR = value;
        crLLOFR = valueLL;
      } else if (invoice.type === 'SR') {
        dr = value;
        drUSD = value;
        drLL = valueLL;
        drOFR = valueOFR;
        drUSDOFR = valueOFR;
        drLLOFR = valueOFRLL;

        cr = value;
        crUSD = value;
        crLL = valueLL;
        crOFR = valueOFR;
        crUSDOFR = valueOFR;
        crLLOFR = valueOFRLL;
      }

      const drLine = this.journalVoucherDetailRepo.create({
        accountId: row.accountId ?? null,
        docNbr: jvNumber, // ✅
        description:"فاتورة شراء",
        dr,
        drUSD,
        drLL,
        drOFR,
        drUSDOFR,
        drLLOFR,
        cr: 0,
        crUSD: 0,
        crLL: 0,
        crOFR: 0,
        crUSDOFR: 0,
        crLLOFR: 0,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      });

      const crLine = this.journalVoucherDetailRepo.create({
        supplierId: row.supplierId ?? null,
        docNbr: jvNumber, // ✅
 description:"فاتورة شراء",
        dr: 0,
        drUSD: 0,
        drLL: 0,
        drOFR: 0,
        drUSDOFR: 0,
        drLLOFR: 0,
        cr,
        crUSD,
        crLL,
        crOFR,
        crUSDOFR,
        crLLOFR,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      });

      extraJVDetails.push(drLine, crLine);
    }
  }

  const jv = this.journalVoucherRepo.create({
    jvNumber,
    purchaseInvoiceId: invoice.id,
    date: invoice.jvDate,
    jvType: invoice.type,
    totalDr: hdrDr,
    totalDrUSD: hdrDrUSD,
    totalDrLL: hdrDrLL,
    totalDrOFR: hdrDrOFR,
    totalDrUSDOFR: hdrDrUSDOFR,
    totalDrLLOFR: hdrDrLLOFR,
    totalCr: hdrCr,
    totalCrUSD: hdrCrUSD,
    totalCrLL: hdrCrLL,
    totalCrOFR: hdrCrOFR,
    totalCrUSDOFR: hdrCrUSDOFR,
    totalCrLLOFR: hdrCrLLOFR,
    exchangeRateAcc: null,
    exchangeRateUSD: null,
    details: [debitLine, creditLine, ...extraJVDetails],
  });

  await this.journalVoucherRepo.save(jv);
}




async update(id: number, data: Partial<PurchaseInvoice>) {
  // 0) Load existing invoice
  const existing = await this.invoiceRepo.findOne({
    where: { id },
    relations: ['items', 'items.itemVariant'],
  });
  if (!existing) {
    throw new NotFoundException(`PurchaseInvoice ${id} not found`);
  }

  const prevStatus = existing.status;
  const prevType = existing.type;
  const prevDate = new Date(existing.date);
  const prevItemIds = (existing.items ?? []).map((it) => it.id);

  // ✅ capture variantIds that were on this invoice BEFORE change
  const prevVariantIds = Array.from(
    new Set(
      (existing.items ?? [])
        .map((it: any) => Number(it.itemVariantId))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  );

  // 🔹 Capture old batchIds from ALL previous txs for this invoice
  let oldBatchIds: number[] = [];
  if (prevItemIds.length) {
    const oldTxs = await this.inventoryTxRepo.find({
      where: { purchaseInvoiceItemId: In(prevItemIds) },
    });

    oldBatchIds = Array.from(
      new Set(
        oldTxs
          .map((tx) => tx.itemBatchId)
          .filter((id) => Number.isFinite(Number(id)))
          .map((id) => Number(id)),
      ),
    );

    console.log('[UPDATE] oldBatchIds from previous txs:', oldBatchIds);
  }

  // 0.1) Split payload
  const {
    items: incomingItemsPayload,
    unitPriceRows: incomingUnitPriceRowsPayload,
    ...headerPayload
  } = (data as any) || {};

  // 1) Apply ONLY header fields
  Object.assign(existing, headerPayload);
  (existing as any).unitPriceRows = undefined;

  // 2) Upsert items
  const incomingItems = (incomingItemsPayload ?? []).map((it: any) => ({
    ...it,
  }));
  const incomingItemIdSet = new Set<number>(
    incomingItems.filter((i) => i.id).map((i) => Number(i.id)),
  );

  const toDeleteItemIds = prevItemIds.filter(
    (oldId) => !incomingItemIdSet.has(oldId),
  );

  if (toDeleteItemIds.length) {
    // delete inventory transactions & items that are being removed
    await this.inventoryTxRepo.delete({
      purchaseInvoiceItemId: In(toDeleteItemIds),
    });
    await this.itemRepo.delete(toDeleteItemIds);
  }

  const upsertedItems: PurchaseInvoiceItem[] = [];
  for (const raw of incomingItems) {
    if (raw.id) {
      await this.itemRepo.update(raw.id, {
        ...raw,
        invoiceId: existing.id,
      });
      const updated = await this.itemRepo.findOne({ where: { id: raw.id } });
      if (updated) upsertedItems.push(updated);
    } else {
      const created = this.itemRepo.create({
        ...raw,
        invoice: { id: existing.id },
        invoiceId: existing.id,
      });
      const savedOneOrMany = (await this.itemRepo.save(
        created,
      )) as PurchaseInvoiceItem | PurchaseInvoiceItem[];
      if (Array.isArray(savedOneOrMany)) upsertedItems.push(...savedOneOrMany);
      else upsertedItems.push(savedOneOrMany);
    }
  }

  // reload items so existing.items has the final set + ids
  existing.items = await this.itemRepo.find({
    where: { invoice: { id: existing.id } },
  });

  // 3) Save invoice header
  console.log('[SAVE][invoiceRepo.save] about to run (header)', {
    id: existing.id,
    headerKeys: Object.keys(existing || {}),
  });
  const savedInvoice = await this.invoiceRepo.save(existing);

  // ─────────────────────────────────────────────
  // 4.0) Sync inventory transactions
  //      - delete ALL old txs for this invoice's items
  //      - rebuild them from the updated invoice
  //      - BUT we also pass oldBatchIds so batches from deleted items are fixed
  // ─────────────────────────────────────────────
  if (prevItemIds.length) {
    await this.inventoryTxRepo.delete({
      purchaseInvoiceItemId: In(prevItemIds),
    });
  }

  // Use existing (which already has items) to rebuild inventory
  await this.rebuildInventoryForPurchaseInvoice(
    {
      ...(savedInvoice as any),
      items: existing.items,
    } as PurchaseInvoice,
    oldBatchIds, // ✅ also recompute batches that were touched by OLD txs
  );

  // ─────────────────────────────────────────────
  // 4.2) delete/rebuild JV (if you want JV to follow edits as well)
  // ─────────────────────────────────────────────
  const existingJvs = await this.journalVoucherRepo.find({
    where: { purchaseInvoiceId: savedInvoice.id },
  });

  if (existingJvs.length) {
    const jvIds = existingJvs
      .map((j) => j.id)
      .filter((x) => Number.isFinite(Number(x)))
      .map((x) => Number(x));

    if (jvIds.length) {
      // 1) delete details rows referencing these JVs
      await this.journalVoucherDetailRepo.delete({
        journalVoucherId: In(jvIds),
      } as any);

      // 2) delete JV header rows themselves
      await this.journalVoucherRepo.delete({
        id: In(jvIds),
      } as any);
    }
  }

  // 3) recreate JV based on the NEW invoice + NEW unitPriceRows payload
  await this.createOrRebuildJVForPurchaseInvoice(
    { ...(savedInvoice as any), items: existing.items } as PurchaseInvoice,
    existing.items,
    incomingUnitPriceRowsPayload,
  );

  // 4.3) delete old unit_price_modal_rows for this invoice
  console.log('[UNITPRICE][DELETE] deleting all unit price rows by invoiceId', {
    invoiceId: savedInvoice.id,
  });
  await this.rowRepo.delete({ invoiceId: savedInvoice.id });
  const checkAfterDelete = await this.rowRepo.find({
    where: { invoiceId: savedInvoice.id },
  });
  console.log('[UNITPRICE][AFTER DELETE] rows found:', checkAfterDelete.length);

  // 6) Re-create UnitPrice rows from payload
  if (incomingUnitPriceRowsPayload?.length) {
    const normalized = incomingUnitPriceRowsPayload.map((r: any) => {
      const v = Number(r.value ?? 0);
      const o = Number(r.valueOFR ?? 0);
      const ex = Number(r.valueExch ?? 0);
      const eo = Number(r.valueExchOFR ?? 0);

      return {
        ...r,
        value: v,
        valueOFR: v > 0 && o === 0 ? v : o,
        valueExch: ex,
        valueExchOFR: ex > 0 && eo === 0 ? ex : eo,
      };
    });

    const rowsToSave = normalized.map((row: any) => {
      const accountId =
        row.accountId != null
          ? Number(row.accountId)
          : row.account?.id != null
          ? Number(row.account.id)
          : null;

      const supplierId =
        row.supplierId != null
          ? Number(row.supplierId)
          : row.supplier?.id != null
          ? Number(row.supplier.id)
          : null;

      const { id: _rowId, account, supplier, ...rest } = row;

      return this.rowRepo.create({
        invoice: { id: savedInvoice.id },
        invoiceId: savedInvoice.id,

        purchaseInvoiceSettingId: rest.purchaseInvoiceSettingId ?? null,
        chargeName: rest.chargeName,
        chargeType: rest.chargeType,
        value: rest.value,
        valueOFR: rest.valueOFR,
        currency: rest.currency,
        valueExch: rest.valueExch,
        valueExchOFR: rest.valueExchOFR,
        addToItemCost: rest.addToItemCost,
        invoiceNbTax: rest.invoiceNbTax,
        shipping: rest.shipping,

        accountId,
        account: accountId ? ({ id: accountId } as any) : null,

        supplierId,
        supplier: supplierId ? ({ id: supplierId } as any) : null,
      });
    });

    console.log('[UNITPRICE][rowsToSave]', rowsToSave);
    await this.rowRepo.save(rowsToSave);
  }

  // …after your inventory transactions and variant‐totals logic…
  const clampPrevQty = (raw: any, label: string, ctx: any = {}) => {
    let n = Number(raw);
    if (!Number.isFinite(n)) n = 0;

    if (n < 0) {
      console.warn(`⚠️ ${label} was negative → clamped to 0`, { raw, n, ...ctx });
      return 0;
    }
    return n;
  };

  if (savedInvoice.status === 'Recieved') {
    const scope = 'PO:COSTS';
    const invDate = new Date(savedInvoice.date);
    const dayStart = new Date(invDate);
    dayStart.setHours(0, 0, 0, 0);

    const items = savedInvoice.items ?? [];
    const currPiiIds = items
      .map((i) => i.id)
      .filter((x) => Number.isFinite(Number(x)));

    console.log(`[${scope}] start`, {
      invoiceId: savedInvoice.id,
      invoiceDate: savedInvoice.date,
      dayStart: dayStart.toISOString(),
      itemsCount: items.length,
      currPiiIdsCount: currPiiIds.length,
    });

    // --- preload variant -> descId for grouping ---
    const variantIdsInInvoice = Array.from(
      new Set(
        items
          .map((i) => Number(i.itemVariantId))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    );

    const variantRows = variantIdsInInvoice.length
      ? await this.variantRepo.find({
          where: { id: In(variantIdsInInvoice) },
          select: ['id', 'itemNameDescriptionId'],
        })
      : [];

    const variantToDesc = new Map<number, number | null>(
      variantRows.map((v: any) => [Number(v.id), v.itemNameDescriptionId ?? null]),
    );

    const itemsByDesc = new Map<number, PurchaseInvoiceItem[]>();
    for (const it of items) {
      const vid = Number(it.itemVariantId);
      const descId = variantToDesc.get(vid);
      if (!descId) continue;
      if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
      itemsByDesc.get(descId)!.push(it);
    }
    const descIds = Array.from(itemsByDesc.keys());

    // ------------------------------------------------------------------
    // A) PER-VARIANT: averageCost (OFR) + averageCostVM (VM)
    // ------------------------------------------------------------------
    for (const it of items) {
      const vid = Number(it.itemVariantId);
      if (!Number.isFinite(vid) || vid <= 0) continue;

      const prevOfr = await resolvePrevVariant(
        this.itemRepo,
        this.inventoryTxRepo,
        this.invTransRepo.manager,
        this.variantRepo,
        vid,
        'OFR',
        'averageCost',
        dayStart,
        currPiiIds,
      );

      const prevVm = await resolvePrevVariant(
        this.itemRepo,
        this.inventoryTxRepo,
        this.invTransRepo.manager,
        this.variantRepo,
        vid,
        'VM',
        'averageCostVM',
        dayStart,
        currPiiIds,
      );

      const poQtyOfr = getItemQty(it, 'OFR');
      const poCostOfr = getItemCost(it, 'OFR');
      const poQtyVm = getItemQty(it, 'VM');
      const poCostVm = getItemCost(it, 'VM');

      const totalOfr = prevOfr.prevQty + poQtyOfr;
      const newAvgOfr =
        totalOfr > 0
          ? (prevOfr.prevAvg * prevOfr.prevQty + poCostOfr * poQtyOfr) / totalOfr
          : prevOfr.prevAvg;

      const totalVm = prevVm.prevQty + poQtyVm;
      const newAvgVm =
        totalVm > 0
          ? (prevVm.prevAvg * prevVm.prevQty + poCostVm * poQtyVm) / totalVm
          : prevVm.prevAvg;

      await this.itemRepo.update(it.id, {
        previousQuantity: prevOfr.prevQty,
        previousAverageCost: prevOfr.prevAvg,
        averageCost: newAvgOfr,

        previousQuantityVM: prevVm.prevQty,
        previousAverageCostVM: prevVm.prevAvg,
        averageCostVM: newAvgVm,
      });

      await this.variantRepo.update(vid, {
        averageCost: newAvgOfr,
        lastCost: poCostOfr,

        averageCostVM: newAvgVm,
        lastCostVM: poCostVm,
      });
    }

    // ------------------------------------------------------------------
    // B) PER-DESCRIPTION: averageCostC (OFR) + averageCostCVM (VM)
    // ------------------------------------------------------------------
    for (const descId of descIds) {
      const rows = itemsByDesc.get(descId) ?? [];
      if (!rows.length) continue;

      const variantIdsForDesc = (
        await this.variantRepo.find({
          where: { itemNameDescriptionId: descId } as any,
          select: ['id'],
        })
      )
        .map((v) => Number(v.id))
        .filter((n) => Number.isFinite(n) && n > 0);

      if (!variantIdsForDesc.length) continue;

      const prevQtyC = await sumTxQty(
        this.inventoryTxRepo,
        variantIdsForDesc,
        'OFR',
        dayStart,
        currPiiIds,
      );

      const prevCRow = await this.itemRepo
        .createQueryBuilder('pii')
        .innerJoin('pii.invoice', 'inv')
        .innerJoin('pii.itemVariant', 'iv')
        .where('inv.status = :st', { st: 'Recieved' })
        .andWhere('inv.date < :cut', { cut: dayStart })
        .andWhere('iv.itemNameDescriptionId = :descId', { descId })
        .andWhere('pii.averageCostC IS NOT NULL')
        .orderBy('inv.date', 'DESC')
        .addOrderBy('pii.id', 'DESC')
        .select(['pii.averageCostC AS avg'])
        .getRawOne<{ avg?: string | number | null }>();

      const fbC = await openingsWeightedAvg(this.invTransRepo.manager, variantIdsForDesc, 'OFR');
      const prevAvgC =
        prevCRow?.avg != null ? num(prevCRow.avg, 0) : fbC.avg;

      const poQtyC = rows.reduce((s, r) => s + getItemQty(r, 'OFR'), 0);
      const poWsumC = rows.reduce(
        (s, r) => s + getItemQty(r, 'OFR') * getItemCost(r, 'OFR'),
        0,
      );
      const poCostC = poQtyC > 0 ? poWsumC / poQtyC : 0;

      const totalC = prevQtyC + poQtyC;
      const newAvgC =
        totalC > 0 ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalC : prevAvgC;

      const prevQtyCVM = await sumTxQty(
        this.inventoryTxRepo,
        variantIdsForDesc,
        'VM',
        dayStart,
        currPiiIds,
      );

      const prevCvmRow = await this.itemRepo
        .createQueryBuilder('pii')
        .innerJoin('pii.invoice', 'inv')
        .innerJoin('pii.itemVariant', 'iv')
        .where('inv.status = :st', { st: 'Recieved' })
        .andWhere('inv.date < :cut', { cut: dayStart })
        .andWhere('iv.itemNameDescriptionId = :descId', { descId })
        .andWhere('pii.averageCostCVM IS NOT NULL')
        .orderBy('inv.date', 'DESC')
        .addOrderBy('pii.id', 'DESC')
        .select(['pii.averageCostCVM AS avg'])
        .getRawOne<{ avg?: string | number | null }>();

      const fbCVM = await openingsWeightedAvg(this.invTransRepo.manager, variantIdsForDesc, 'VM');
      const prevAvgCVM =
        prevCvmRow?.avg != null ? num(prevCvmRow.avg, 0) : fbCVM.avg;

      const poQtyCVM = rows.reduce((s, r) => s + getItemQty(r, 'VM'), 0);
      const poWsumCVM = rows.reduce(
        (s, r) => s + getItemQty(r, 'VM') * getItemCost(r, 'VM'),
        0,
      );
      const poCostCVM = poQtyCVM > 0 ? poWsumCVM / poQtyCVM : 0;

      const rawTotalCVM = prevQtyCVM + poQtyCVM;
      const totalCVM = rawTotalCVM < 0 ? 0 : rawTotalCVM;

      const newAvgCVM =
        totalCVM > 0
          ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalCVM
          : prevAvgCVM;

      for (const r of rows) {
        await this.itemRepo.update(r.id, {
          previousQuantityC: prevQtyC,
          previousAverageCostC: prevAvgC,
          averageCostC: newAvgC,

          previousQuantityCVM: prevQtyCVM,
          previousAverageCostCVM: prevAvgCVM,
          averageCostCVM: newAvgCVM,
        } as any);
      }

      const lastRow = rows[rows.length - 1] as any;
      await this.descRepo.update(descId, {
        averageCostC: newAvgC,
        averageCostCVM: newAvgCVM,
        lastCostC: getItemCost(lastRow, 'OFR'),
        lastCostCVM: getItemCost(lastRow, 'VM'),
      } as any);
    }

    console.log(`[${scope}] done`, { invoiceId: savedInvoice.id });
  }

  // ✅ Keep your explicit call
  await this.applyPurchaseCostsForInvoice(savedInvoice.id);

  // ✅ include deleted variants in the affected set
  const currentVariantIds = Array.from(
    new Set(
      (savedInvoice.items ?? [])
        .map((it: any) => Number(it.itemVariantId))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  );

  const removedVariantIds = prevVariantIds.filter(
    (vid) => !currentVariantIds.includes(vid),
  );

  const affected = Array.from(
    new Set([...currentVariantIds, ...removedVariantIds]),
  );

  console.log('[RECOMP][UPDATE] affectedVariantIds', {
    prevVariantIds,
    currentVariantIds,
    removedVariantIds,
    affected,
  });

  // 1) recompute purchase chain for POs (variants + deleted variants)
  await this.recomputePurchaseChainFrom(prevDate, affected);

  // 2) 🔥 recompute all sales invoice_items that use these variants
  await this.recomputeSalesCostsFrom(prevDate, affected);
}
















async getCostAnalysisHistory(q?: string): Promise<any[]> {
  // small helper: normalize Arabic/Arabic-Indic digits to Western 0–9
  const normalizeDigits = (s: string) => {
    if (!s) return '';
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '۸', '۹': '9',
    };
    return s.replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
  };

  // ───────── Base query: all cost history rows ─────────
  const qb = this.itemRepo
    .createQueryBuilder('pii')
    .innerJoin('pii.invoice', 'inv')
    .innerJoin('pii.itemVariant', 'iv')
    .innerJoin('iv.thickness', 'th')
    .innerJoin('th.item', 'i')
    .leftJoin('iv.realDescription', 'rd')
    .where('inv.status = :st', { st: 'Recieved' })
    .andWhere('inv.type IN (:...types)', { types: ['S', 'G', 'SR'] })
    .select([
      // identity / structure
      'iv.id AS variantId',
      'i.itemName AS itemName',
      'th.thickness AS thickness',
      'iv.length AS length',
      'iv.width AS width',
      'iv.origin AS origin',
      'iv.sheetsPerBox AS sheetsPerBox',
      'rd.id AS realDescriptionId',
      'rd.sort_index_real_description AS sortIndex',
      'rd.categoryName AS categoryName',
      'rd.subCategory AS subCategory',
      'rd.colorName AS colorName',
      'rd.designName AS designName',
      'rd.itemNumber AS itemNumber',
      'inv.date AS invoiceDate',

      // 🔹 previous quantities

      'pii.previousQuantity AS previousQuantity',
      'pii.previousQuantityC AS previousQuantityC',
      'pii.previousQuantityVM AS previousQuantityVM',
      'pii.previousQuantityCVM AS previousQuantityCVM',

      // 🔹 previous average costs
      'pii.previousAverageCost AS previousAverageCost',
      'pii.previousAverageCostC AS previousAverageCostC',
      'pii.previousAverageCostVM AS previousAverageCostVM',
      'pii.previousAverageCostCVM AS previousAverageCostCVM',

      // 🔹 OFR price & final OFR
      'pii.priceOFR AS priceOFR',
      'pii.finalOFR AS finalOFR',
      

      // 🔹 current averages
      'pii.averageCost AS averageCost',
      'pii.averageCostC AS averageCostC',
      'pii.averageCostVM AS averageCostVM',
      'pii.averageCostCVM AS averageCostCVM',
    ])
    .orderBy('rd.sort_index_real_description', 'ASC')
    .addOrderBy('i.itemName', 'ASC')
    .addOrderBy('th.thickness', 'ASC')
    .addOrderBy('iv.length', 'ASC')
    .addOrderBy('iv.width', 'ASC')
    .addOrderBy('inv.date', 'ASC')
    .addOrderBy('pii.id', 'ASC');

  // ───────── Parse search text q ─────────
  if (q && q.trim()) {
    const norm = normalizeDigits(q.trim());

    let thickness: number | undefined;
    let nameText: string | undefined;
    let length: number | undefined;
    let width: number | undefined;
    let sheetsPerBox: number | undefined;

    // 1) Find dimension pattern: 225*321-027 OR 225*321
    const dimMatch = norm.match(/(\d+)\s*\*\s*(\d+)(?:\s*-\s*(\d+))?/);
    if (dimMatch) {
      length = Number(dimMatch[1]);
      width = Number(dimMatch[2]);
      if (dimMatch[3]) {
        sheetsPerBox = Number(dimMatch[3]);
      }
    }

    // 2) Find thickness pattern like "5ملم" or "5.5 ملم"
    const thMatch = norm.match(/(\d+(?:\.\d+)?)\s*ملم/);
    if (thMatch) {
      thickness = Number(thMatch[1]);
      // Remove the thickness chunk to get the remaining name text
      const withoutThickness = norm.replace(thMatch[0], ' ');
      const leftover = withoutThickness.replace(dimMatch?.[0] ?? '', ' ').trim();
      if (leftover) {
        nameText = leftover;
      }
    } else {
      // No explicit "5ملم" → treat all text (except dims) as name search
      const withoutDims = norm.replace(dimMatch?.[0] ?? '', ' ').trim();
      if (withoutDims) {
        nameText = withoutDims;
      }
    }

    // 3) Apply filters to the query
    if (typeof thickness === 'number' && !Number.isNaN(thickness)) {
      qb.andWhere('th.thickness = :thickness', { thickness });
    }

    if (typeof length === 'number' && !Number.isNaN(length)) {
      qb.andWhere('iv.length = :len', { len: length });
    }

    if (typeof width === 'number' && !Number.isNaN(width)) {
      qb.andWhere('iv.width = :wid', { wid: width });
    }

    if (typeof sheetsPerBox === 'number' && !Number.isNaN(sheetsPerBox)) {
      qb.andWhere('iv.sheetsPerBox = :spb', { spb: sheetsPerBox });
    }

    if (nameText && nameText.length >= 1) {
      const like = `%${nameText}%`;
      qb.andWhere(
        `
        (
          i.itemName LIKE :txt
          OR rd.colorName LIKE :txt
          OR rd.designName LIKE :txt
          OR rd.categoryName LIKE :txt
          OR rd.subCategory LIKE :txt
        )
      `,
        { txt: like },
      );
    }
  }

  // ───────── Execute and return raw rows ─────────
  const raw = await qb.getRawMany();
  return raw;
}




// make sure these are imported at top of the file:
// import { InventoryCount } from '../inventory/count.entity';
// import { ItemVariant } from '../inventory/itemVariant.entity';

async getRealDescriptionCostHistory(q?: string): Promise<any[]> {
  // small helper: normalize Arabic/Arabic-Indic digits to Western 0–9
  const normalizeDigits = (s: string) => {
    if (!s) return '';
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    };
    return s.replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
  };

  // ───────── Base query: all POs that contain variants under each RealDescription ─────────
  const qb = this.itemRepo
    .createQueryBuilder('pii') // PurchaseInvoiceItem
    .innerJoin('pii.invoice', 'inv')
    .innerJoin('pii.itemVariant', 'iv')
    .innerJoin('iv.thickness', 'th')
    .innerJoin('th.item', 'i')
    .leftJoin('iv.realDescription', 'rd')
    .where('inv.status = :st', { st: 'Recieved' })
    .andWhere('inv.type IN (:...types)', { types: ['S', 'G', 'SR'] })
    // optional: ignore variants that don’t have a real description
    .andWhere('rd.id IS NOT NULL');

  // ───────── Parse search text q (same concept as variant API) ─────────
  if (q && q.trim()) {
    const norm = normalizeDigits(q.trim());

    let thickness: number | undefined;
    let nameText: string | undefined;
    let length: number | undefined;
    let width: number | undefined;
    let sheetsPerBox: number | undefined;

    // 1) Find dimension pattern: 225*321-027 OR 225*321
    const dimMatch = norm.match(/(\d+)\s*\*\s*(\d+)(?:\s*-\s*(\d+))?/);
    if (dimMatch) {
      length = Number(dimMatch[1]);
      width = Number(dimMatch[2]);
      if (dimMatch[3]) {
        sheetsPerBox = Number(dimMatch[3]);
      }
    }

    // 2) Find thickness pattern like "5ملم" or "5.5 ملم"
    const thMatch = norm.match(/(\d+(?:\.\d+)?)\s*ملم/);
    if (thMatch) {
      thickness = Number(thMatch[1]);
      // remove thickness part to get remaining name text
      const withoutThickness = norm.replace(thMatch[0], ' ');
      const leftover = withoutThickness.replace(dimMatch?.[0] ?? '', ' ').trim();
      if (leftover) {
        nameText = leftover;
      }
    } else {
      // no explicit thickness -> treat remaining text as name search
      const withoutDims = norm.replace(dimMatch?.[0] ?? '', ' ').trim();
      if (withoutDims) {
        nameText = withoutDims;
      }
    }

    // 3) Apply filters
    if (typeof thickness === 'number' && !Number.isNaN(thickness)) {
      qb.andWhere('th.thickness = :thickness', { thickness });
    }

    if (typeof length === 'number' && !Number.isNaN(length)) {
      qb.andWhere('iv.length = :len', { len: length });
    }

    if (typeof width === 'number' && !Number.isNaN(width)) {
      qb.andWhere('iv.width = :wid', { wid: width });
    }

    if (typeof sheetsPerBox === 'number' && !Number.isNaN(sheetsPerBox)) {
      qb.andWhere('iv.sheetsPerBox = :spb', { spb: sheetsPerBox });
    }

    if (nameText && nameText.length >= 1) {
      const like = `%${nameText}%`;
      qb.andWhere(
        `
        (
          i.itemName LIKE :txt
          OR rd.colorName LIKE :txt
          OR rd.designName LIKE :txt
          OR rd.categoryName LIKE :txt
          OR rd.subCategory LIKE :txt
        )
      `,
        { txt: like },
      );
    }
  }

  // ───────── Subqueries for OPENING counts per RealDescription ─────────
  const openingsSubC = qb.subQuery()
    .select('COALESCE(SUM(ic.sqmOfr), 0)')
    .from(InventoryCount, 'ic')
    .innerJoin(ItemVariant, 'iv2', 'iv2.id = ic.itemVariantId')
    .where('iv2.realDescriptionId = rd.id')
    .getQuery();

  const openingsSubVM = qb.subQuery()
    .select('COALESCE(SUM(ic.sqm), 0)')
    .from(InventoryCount, 'ic')
    .innerJoin(ItemVariant, 'iv3', 'iv3.id = ic.itemVariantId')
    .where('iv3.realDescriptionId = rd.id')
    .getQuery();

  // ───────── Aggregate per RealDescription + invoice date ─────────
  qb
    .select([
      // description identity
      'rd.id AS realDescriptionId',
      'rd.categoryName AS categoryName',
      'rd.subCategory AS subCategory',
      'rd.colorName AS colorName',
      'rd.designName AS designName',
      'rd.itemNumber AS itemNumber',
      'rd.sort_index_real_description AS sortIndex',

      // item base name (for context)
      'i.itemName AS itemName',

      // 🔹 representative thickness for this RealDescription
      'MIN(th.thickness) AS thickness',

      // invoice date (history)
      'inv.date AS invoiceDate',

      // 🔹 summed previous quantity C (before this invoice)
      'SUM(pii.previousQuantityC) AS previousQuantityC',

      // 🔹 PO quantity for this description on this invoice (sqm)
      'SUM(pii.sqm) AS poQty',

      // 🔹 average cost C (simple average of PII.averageCostC)
      'AVG(pii.averageCostC) AS averageCostC',

      // 🔹 weighted last cost C for this invoice/description
      `CASE 
         WHEN SUM(pii.sqm) = 0 THEN 0 
         ELSE SUM(pii.finalCost * pii.sqm) / SUM(pii.sqm) 
       END AS lastCostC`,

      // 🔹 weighted final OFR cost for this invoice/description
      `CASE 
         WHEN SUM(pii.sqm) = 0 THEN 0 
         ELSE SUM(pii.finalOFR * pii.sqm) / SUM(pii.sqm) 
       END AS finalCostOFR`,
    ])
    // opening stock (C & VM) via subqueries
    .addSelect(`(${openingsSubC})`, 'openingQuantityC')
    .addSelect(`(${openingsSubVM})`, 'openingQuantityVM')
    .groupBy('rd.id')
    .addGroupBy('inv.date')
    .addGroupBy('rd.categoryName')
    .addGroupBy('rd.subCategory')
    .addGroupBy('rd.colorName')
    .addGroupBy('rd.designName')
    .addGroupBy('rd.itemNumber')
    .addGroupBy('rd.sort_index_real_description')
    .addGroupBy('i.itemName')
    .orderBy('rd.sort_index_real_description', 'ASC')
    .addOrderBy('rd.categoryName', 'ASC')
    .addOrderBy('rd.subCategory', 'ASC')
    .addOrderBy('rd.colorName', 'ASC')
    .addOrderBy('rd.designName', 'ASC')
    .addOrderBy('inv.date', 'ASC');

  const raw = await qb.getRawMany();
  return raw;
}



}
