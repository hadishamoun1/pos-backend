// src/Purchase-invoice/purchase-invoice.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, } from '@nestjs/typeorm';
import {
  Repository,
  In,
  EntityManager,
  SelectQueryBuilder,
  Brackets,
  DeepPartial 
} from 'typeorm';
import { Transfer } from '../entities/inventory/transfer.entity';

import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { PurchaseVoucherDetail } from '../entities/Vouchers/purchaseVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { Item } from '../entities/inventory/item.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Settings } from '../entities/settings.entity';
import { AccountingResolverService } from '../accountRoleMap/accounting-resolver.service';
import { computeDiff } from '../common/compute-diff';


export type Chain = 'OFR' | 'VM';

export const num = (v: any, fb = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fb;

/** qty used in cost formula */
export const getItemQty = (it: any, chain: Chain) =>
  chain === 'OFR'
    ? num(it?.sqmOfr ?? it?.sqmofr ?? it?.sqmOFR ?? it?.sqm_ofr ?? 0)
    : num(it?.sqm ?? 0);

/** cost per sqm used in cost formula */
export const getItemCost = (it: any, chain: Chain) =>
  chain === 'OFR'
    ? num(
        it?.finalOFR ??
          it?.finalOfr ??
          it?.finalcostofr ??
          it?.finalCostOfr ??
          0,
      )
    : num(it?.finalCost ?? it?.finalcost ?? it?.finalcostvm ?? 0);

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

    @InjectRepository(Settings)
private readonly settingsRepo: Repository<Settings>,

private readonly accountingResolver: AccountingResolverService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────
  private startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private uniqNums(xs: any[]) {
    return Array.from(new Set(xs.map(Number).filter((n) => Number.isFinite(n) && n > 0)));
  }

private intOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

private numOrZero(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}



  private clampPrevQty(raw: any) {
    let n = Number(raw);
    if (!Number.isFinite(n)) n = 0;
    if (n < 0) n = 0;
    return n;
  }

  // ────────────────────────────────────────────────────────────
  // PREV quantity from tx + fallback to counts
  // ────────────────────────────────────────────────────────────
  private async sumTxQtyDetailed(
    variantIds: number[],
    chain: Chain,
    cutoff: Date,
    currPiiIds: number[],
    useQtyCol = false,
  ): Promise<{ sum: number; txCount: number }> {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return { sum: 0, txCount: 0 };

    // unit items (stockMode=QTY) are counted by quantityofr, not sqmofr
    const col = useQtyCol ? 'tx.quantityofr' : (chain === 'OFR' ? 'tx.sqmofr' : 'tx.sqm');

    const applyBase = (qb: SelectQueryBuilder<InventoryTransaction>) => {
      qb.where('tx.itemVariantId IN (:...ids)', { ids })
        .andWhere('tx.dateForEachInvoice < :cut', { cut: cutoff });

      if (currPiiIds.length) {
        qb.andWhere(
          '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
          { currIds: currPiiIds },
        );
      }
      return qb;
    };

    const qbCount = applyBase(
      this.inventoryTxRepo.createQueryBuilder('tx').select('COUNT(*)', 'cnt'),
    );
    const rawCount = (await qbCount.getRawOne()) as { cnt?: string | number } | undefined;
    const txCount = num(rawCount?.cnt, 0);

    const qbSum = applyBase(
      this.inventoryTxRepo
        .createQueryBuilder('tx')
        .select(`SUM(COALESCE(${col},0))`, 'sum'),
    );
    const raw = (await qbSum.getRawOne()) as { sum?: string | number | null } | undefined;

    return { sum: num(raw?.sum, 0), txCount };
  }

  private async countFallbackPrevQty(
    invManager: EntityManager,
    variantIds: number[],
    chain: Chain,
  ) {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return 0;

    const qtyField = chain === 'OFR' ? 'cnt.sqmOfr' : 'cnt.sqm';

    const qb = invManager
      .getRepository(InventoryCount)
      .createQueryBuilder('cnt')
      .select(`SUM(COALESCE(${qtyField},0))`, 'sumQty')
      .where('cnt.itemVariantId IN (:...ids)', { ids });

    const raw = (await qb.getRawOne()) as { sumQty?: string | number | null } | undefined;
    return num(raw?.sumQty, 0);
  }

  private async openingsWeightedAvg(
    invManager: EntityManager,
    variantIds: number[],
    chain: Chain,
  ) {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return { qty: 0, avg: 0 };

    const qtyField = chain === 'OFR' ? 'cnt.sqmOfr' : 'cnt.sqm';
    const costField = chain === 'OFR' ? 'cnt.finalCostOfr' : 'cnt.finalCost';

    const qb = invManager
      .getRepository(InventoryCount)
      .createQueryBuilder('cnt')
      .select(`COALESCE(${qtyField},0)`, 'qty')
      .addSelect(`COALESCE(${costField},0)`, 'cost')
      .where('cnt.itemVariantId IN (:...ids)', { ids });

    const rows = (await qb.getRawMany()) as Array<{ qty: any; cost: any }>;

    const qty = rows.reduce((s, r) => s + num(r.qty, 0), 0);
    const wsum = rows.reduce((s, r) => s + num(r.qty, 0) * num(r.cost, 0), 0);
    const avg = qty > 0 ? wsum / qty : 0;

    return { qty, avg };
  }

  // ────────────────────────────────────────────────────────────
  // “last event” support (purchase/transfer/count)
  // ────────────────────────────────────────────────────────────
  private async getLastTxBefore(
    variantIds: number[],
    cutoff: Date,
    currPiiIds: number[],
  ) {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return null;

    const qb = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .where('tx.itemVariantId IN (:...ids)', { ids })
      .andWhere('tx.dateForEachInvoice < :cut', { cut: cutoff });

    if (currPiiIds.length) {
      qb.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
        { currIds: currPiiIds },
      );
    }

    // prefer dateForEachInvoice then id
    qb.orderBy('tx.dateForEachInvoice', 'DESC').addOrderBy('tx.id', 'DESC').limit(1);

    return (await qb.getOne()) ?? null;
  }

  private async getCountCostById(
    invManager: EntityManager,
    countId: number,
    chain: Chain,
  ) {
    if (!countId) return 0;
    const cnt = await invManager.getRepository(InventoryCount).findOne({ where: { id: countId } as any });
    if (!cnt) return 0;
    return chain === 'OFR' ? num((cnt as any).finalCostOfr, 0) : num((cnt as any).finalCost, 0);
  }

  // ────────────────────────────────────────────────────────────
  // Resolve prev for VARIANT (avgCost / avgCostVM)
  // - prevQty: tx sum (fallback to counts only when no tx rows)
  // - prevAvg: depends on LAST EVENT
  // ────────────────────────────────────────────────────────────
  private async resolvePrevVariant(
    invManager: EntityManager,
    variantId: number,
    chain: Chain,
    avgField: 'averageCost' | 'averageCostVM',
    dayStart: Date,
    currPiiIds: number[],
    useQtyCol = false,
  ) {
    const ids = [variantId];

    // qty
    const { sum: txSum, txCount } = await this.sumTxQtyDetailed(ids, chain, dayStart, currPiiIds, useQtyCol);
    let prevQty = txSum;

    if (txCount === 0) {
      prevQty = await this.countFallbackPrevQty(invManager, ids, chain);
    }
    prevQty = this.clampPrevQty(prevQty);

    // last event
    const lastTx = await this.getLastTxBefore(ids, dayStart, currPiiIds);

    // avg
    let prevAvg = 0;

    if (lastTx?.transactionType === 'purchase') {
      // take avg from latest previous PO row
      const prev = (await this.itemRepo
        .createQueryBuilder('pii')
        .innerJoin('pii.invoice', 'inv')
        .where('pii.itemVariantId = :vid', { vid: variantId })
        .andWhere('inv.status = :st', { st: 'Recieved' })
        .andWhere('inv.date < :cut', { cut: dayStart })
        .andWhere(`pii.${avgField} IS NOT NULL`)
        .orderBy('inv.date', 'DESC')
        .addOrderBy('pii.id', 'DESC')
        .select([`pii.${avgField} AS avg`])
        .getRawOne()) as { avg?: string | number | null } | undefined;

      prevAvg = prev?.avg != null ? num(prev.avg, 0) : 0;
    } else if (lastTx?.inventoryCountId) {
      // last event is a COUNT -> use that count cost
      prevAvg = await this.getCountCostById(invManager, Number(lastTx.inventoryCountId), chain);
    } else {
      // transfer/other -> use stored current averages on ItemVariant
      const v = await this.variantRepo.findOne({
        where: { id: variantId } as any,
        select: ['id', 'averageCost', 'averageCostVM'] as any,
      });
      prevAvg = chain === 'OFR' ? num((v as any)?.averageCost, 0) : num((v as any)?.averageCostVM, 0);

      // if still empty, fallback to openings weighted avg
      if (!prevAvg) {
        const open = await this.openingsWeightedAvg(invManager, ids, chain);
        prevAvg = open.avg;
      }
    }

    return { prevQty, prevAvg };
  }

  // ────────────────────────────────────────────────────────────
  // Resolve prev for DESCRIPTION (avgCostC / avgCostCVM)
  // - prevQty: tx sum over all variants in desc (fallback to counts only when no tx rows)
  // - prevAvg: depends on LAST EVENT (purchase/count/transfer)
  // ────────────────────────────────────────────────────────────
  private async resolvePrevDesc(
    invManager: EntityManager,
    descId: number,
    variantIdsForDesc: number[],
    chain: Chain,
    avgField: 'averageCostC' | 'averageCostCVM',
    dayStart: Date,
    currPiiIds: number[],
  ) {
    const ids = this.uniqNums(variantIdsForDesc);
    if (!ids.length) return { prevQty: 0, prevAvg: 0 };

    const { sum: txSum, txCount } = await this.sumTxQtyDetailed(ids, chain, dayStart, currPiiIds);
    let prevQty = txSum;
    if (txCount === 0) {
      prevQty = await this.countFallbackPrevQty(invManager, ids, chain);
    }
    prevQty = this.clampPrevQty(prevQty);

    const lastTx = await this.getLastTxBefore(ids, dayStart, currPiiIds);

    let prevAvg = 0;

    if (lastTx?.transactionType === 'purchase') {
      const prev = (await this.itemRepo
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
        .getRawOne()) as { avg?: string | number | null } | undefined;

      prevAvg = prev?.avg != null ? num(prev.avg, 0) : 0;
    } else if (lastTx?.inventoryCountId) {
      // last event is COUNT -> use openings weighted avg for the desc (more stable than 1 row)
      const open = await this.openingsWeightedAvg(invManager, ids, chain);
      prevAvg = open.avg;
    } else {
      // transfer/other -> use stored current averages on ItemNameDescription
      const d = await this.descRepo.findOne({
        where: { id: descId } as any,
        select: ['id', 'averageCostC', 'averageCostCVM'] as any,
      });
      prevAvg =
        chain === 'OFR'
          ? num((d as any)?.averageCostC, 0)
          : num((d as any)?.averageCostCVM, 0);

      if (!prevAvg) {
        const open = await this.openingsWeightedAvg(invManager, ids, chain);
        prevAvg = open.avg;
      }
    }

    return { prevQty, prevAvg };
  }

  // ────────────────────────────────────────────────────────────
  // Compute + write averages ONLY for this invoice (NO RECOMPUTE CHAIN)
  // ────────────────────────────────────────────────────────────
  private async computeAndWriteCostsForInvoice(invoiceId: number) {
    const savedInvoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId } as any,
      relations: ['items'],
    });
    if (!savedInvoice) return;
    if (savedInvoice.status !== 'Recieved') return;

    const invDate = new Date(savedInvoice.date);
    const dayStart = this.startOfDay(invDate);

    const items = savedInvoice.items ?? [];
    if (!items.length) return;

    const currPiiIds = items
      .map((i: any) => Number(i.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    const invManager = this.inventoryTxRepo.manager;

    // Map variant -> descId for grouping
    const itemVariantIds = this.uniqNums(items.map((i: any) => i.itemVariantId));
    const variantRows = itemVariantIds.length
      ? await this.variantRepo.find({
          where: { id: In(itemVariantIds) } as any,
          select: ['id', 'itemNameDescriptionId'] as any,
        })
      : [];

    const variantToDesc = new Map<number, number | null>(
      variantRows.map((v: any) => [Number(v.id), v.itemNameDescriptionId ?? null]),
    );

    // Detect unit items (stockMode=QTY or type=unit) — they use quantity, not sqm, as weight
    const unitVariantSet = new Set<number>();
    if (itemVariantIds.length) {
      const unitRows: { vid: number }[] = await this.variantRepo
        .createQueryBuilder('v')
        .innerJoin('v.thickness', 't')
        .innerJoin('t.item', 'i')
        .select('v.id', 'vid')
        .where('v.id IN (:...ids)', { ids: itemVariantIds })
        .andWhere("(i.stockMode = 'QTY' OR i.type = 'unit')")
        .getRawMany();
      for (const r of unitRows) unitVariantSet.add(Number(r.vid));
    }

    const itemsByDesc = new Map<number, PurchaseInvoiceItem[]>();
    for (const it of items) {
      const descId = variantToDesc.get(Number((it as any).itemVariantId));
      if (descId == null) continue;
      if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
      itemsByDesc.get(descId)!.push(it as any);
    }
    const descIds = Array.from(itemsByDesc.keys());

    // A) per-variant (averageCost / averageCostVM)
    for (const it of items) {
      const vid = Number((it as any).itemVariantId);
      if (!Number.isFinite(vid) || vid <= 0) continue;

      const isUnit = unitVariantSet.has(vid);

      const prevOfr = await this.resolvePrevVariant(
        invManager,
        vid,
        'OFR',
        'averageCost',
        dayStart,
        currPiiIds,
        isUnit,
      );
      const prevVm = await this.resolvePrevVariant(
        invManager,
        vid,
        'VM',
        'averageCostVM',
        dayStart,
        currPiiIds,
        isUnit,
      );

      // Unit items: weight = pieces (quantity), cost = totalOFR / quantity
      // Tile items: weight = sqm (sqmOfr),     cost = finalOFR (per sqm)
      const poQtyOfr  = isUnit ? num((it as any).quantity) : getItemQty(it, 'OFR');
      const poCostOfr = isUnit
        ? (num((it as any).quantity) > 0 ? num((it as any).totalOFR) / num((it as any).quantity) : 0)
        : getItemCost(it, 'OFR');
      const poQtyVm  = isUnit ? num((it as any).quantity) : getItemQty(it, 'VM');
      const poCostVm = isUnit
        ? (num((it as any).quantity) > 0 ? num((it as any).totalAmount) / num((it as any).quantity) : 0)
        : getItemCost(it, 'VM');

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

      await this.itemRepo.update((it as any).id, {
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

    // B) per-description (averageCostC / averageCostCVM) on ItemNameDescription
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
        .filter((n) => Number.isFinite(n) && n > 0);

      if (!variantIdsForDesc.length) continue;

      // OFR (C)
      const prevC = await this.resolvePrevDesc(
        invManager,
        descId,
        variantIdsForDesc,
        'OFR',
        'averageCostC',
        dayStart,
        currPiiIds,
      );

      const poQtyC = rows.reduce((s, r) => s + getItemQty(r, 'OFR'), 0);
      const poWsumC = rows.reduce(
        (s, r) => s + getItemQty(r, 'OFR') * getItemCost(r, 'OFR'),
        0,
      );
      const poCostC = poQtyC > 0 ? poWsumC / poQtyC : 0;

      const totalC = prevC.prevQty + poQtyC;
      const newAvgC =
        totalC > 0 ? (prevC.prevAvg * prevC.prevQty + poCostC * poQtyC) / totalC : prevC.prevAvg;

      // VM (CVM)
      const prevCvm = await this.resolvePrevDesc(
        invManager,
        descId,
        variantIdsForDesc,
        'VM',
        'averageCostCVM',
        dayStart,
        currPiiIds,
      );

      const poQtyCVM = rows.reduce((s, r) => s + getItemQty(r, 'VM'), 0);
      const poWsumCVM = rows.reduce(
        (s, r) => s + getItemQty(r, 'VM') * getItemCost(r, 'VM'),
        0,
      );
      const poCostCVM = poQtyCVM > 0 ? poWsumCVM / poQtyCVM : 0;

      const totalCVM = prevCvm.prevQty + poQtyCVM;
      const newAvgCVM =
        totalCVM > 0
          ? (prevCvm.prevAvg * prevCvm.prevQty + poCostCVM * poQtyCVM) / totalCVM
          : prevCvm.prevAvg;

      // write to rows (PurchaseInvoiceItem history fields)
      for (const r of rows) {
        await this.itemRepo.update((r as any).id, {
          previousQuantityC: prevC.prevQty,
          previousAverageCostC: prevC.prevAvg,
          averageCostC: newAvgC,

          previousQuantityCVM: prevCvm.prevQty,
          previousAverageCostCVM: prevCvm.prevAvg,
          averageCostCVM: newAvgCVM,
        } as any);
      }

      // mirror to ItemNameDescription (C/CVM live values)
      await this.descRepo.update(descId, {
        averageCostC: newAvgC,
        averageCostCVM: newAvgCVM,
        lastCostC: poCostC,
        lastCostCVM: poCostCVM,
      } as any);
    }
  }

  // ────────────────────────────────────────────────────────────
  // inventory rebuild (kept from your logic; typed fixes applied)
  // ────────────────────────────────────────────────────────────
  private async rebuildInventoryForPurchaseInvoice(
    savedInvoice: PurchaseInvoice,
    extraBatchIds: number[] = [],
  ): Promise<void> {
    if (!savedInvoice) return;

    const isPosted = savedInvoice.status === 'Recieved';
    const items = (savedInvoice as any).items ?? [];
    if (!items.length && !extraBatchIds.length) return;

    const invoiceDate = new Date(savedInvoice.date);

    // 0) remove old tx rows for this invoice items (caller already did delete; safe anyway)
    const itemIds = items.map((it: any) => Number(it.id)).filter((n: number) => Number.isFinite(n) && n > 0);

    const existingTxs = itemIds.length
      ? await this.inventoryTxRepo.find({ where: { purchaseInvoiceItemId: In(itemIds) } as any })
      : [];

    const batchIdByItemId = new Map<number, number>();
    for (const tx of existingTxs) {
      if ((tx as any).purchaseInvoiceItemId && (tx as any).itemBatchId) {
        batchIdByItemId.set(Number((tx as any).purchaseInvoiceItemId), Number((tx as any).itemBatchId));
      }
    }

    if (existingTxs.length) {
      await this.inventoryTxRepo.delete({ purchaseInvoiceItemId: In(itemIds) } as any);
    }

    const invTxs: InventoryTransaction[] = [];

    // 1) recreate tx rows if posted
    if (isPosted && items.length) {
      for (const item of items) {
        const itemId = Number((item as any).id);
        let existingBatchId = batchIdByItemId.get(itemId) ?? null;

        if (!existingBatchId) {
          const condition = (item as any).condition || 'Clean';
          const invoiceWarehouse = (savedInvoice as any).warehouse ?? 'Shamoun';
          const fallbackBatch = await this.itemBatchRepo.findOne({
            where: {
              itemVariant: { id: Number((item as any).itemVariantId) },
              condition,
              dateReceived: null,
              warehouse: invoiceWarehouse,
            } as any,
          });

          if (fallbackBatch) existingBatchId = fallbackBatch.id;
          else continue;
        }

        const sqmVM = Number((item as any).sqm ?? 0);
        const sqmOFR = Number((item as any).sqmofr ?? (item as any).sqmOfr ?? sqmVM ?? 0);

        const isPR = (savedInvoice as any).type === 'PR';
        const effectiveType = isPR ? ((savedInvoice as any).returnBaseType ?? 'S') : (savedInvoice as any).type;
        const sign = isPR ? -1 : 1;
        const txTransactionType = isPR ? 'purchase return' : 'purchase';

        let qty = sign * Number((item as any).quantity ?? 0);
        let qtyOfr = qty;
        let sqm = sign * sqmVM;
        let sqmofr = sign * sqmOFR;

        switch (effectiveType) {
          case 'S':
          case 'SR':
            qtyOfr = qty;
            sqmofr = sqm;
            break;
          case 'G':
            qtyOfr = qty;
            sqmofr = sign * sqmOFR;
            qty = 0;
            sqm = 0;
            break;
          case 'RVR':
            qtyOfr = 0;
            sqmofr = 0;
            break;
        }

        const tx: InventoryTransaction =
          (this.inventoryTxRepo.create({
            itemVariantId: Number((item as any).itemVariantId),
            itemBatchId: Number(existingBatchId),
            transactionType: txTransactionType,
            quantity: qty,
            sqm: sqm,
            quantityofr: qtyOfr,
            sqmofr: sqmofr,
            finalcost: Number((item as any).finalCost ?? 0),
            finalcostofr: Number((item as any).finalOFR ?? 0),
            purchaseInvoiceItemId: itemId,
            invoiceItemId: null,
            transferId: null,
            inventoryCountId: null,
            dateForEachInvoice: invoiceDate,
          } as any) as any);

        invTxs.push(tx);
      }

      if (invTxs.length) {
        await this.inventoryTxRepo.save(invTxs);
      }
    }

    // 2) recalc batch totals from tx (purchase only)
    const affectedBatchIds = Array.from(
      new Set([
        ...(invTxs.map((tx) => (tx as any).itemBatchId).filter((id) => id != null) as number[]),
        ...extraBatchIds,
      ].map((x) => Number(x))),
    ).filter((n) => Number.isFinite(n) && n > 0);

    const variantIdSet = new Set<number>(
      items
        .map((it: any) => Number(it.itemVariantId))
        .filter((n: number) => Number.isFinite(n) && n > 0),
    );

    for (const batchId of affectedBatchIds) {
      const batch = await this.itemBatchRepo.findOne({
        where: { id: batchId } as any,
        relations: ['itemVariant'],
      });
      if (!batch) continue;

      const variantIdFromBatch =
        (batch as any).itemVariantId ?? (batch.itemVariant ? Number((batch.itemVariant as any).id) : null);
      if (Number.isFinite(variantIdFromBatch) && Number(variantIdFromBatch) > 0) {
        variantIdSet.add(Number(variantIdFromBatch));
      }

      const agg = await this.inventoryTxRepo
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.sqm), 0)', 'sumSqm')
        .addSelect('COALESCE(SUM(tx.sqmofr), 0)', 'sumSqmOfr')
        .where('tx.itemBatchId = :batchId', { batchId })
        .andWhere('tx.transactionType IN (:...txTypes)', { txTypes: ['purchase', 'purchase return'] })
        .getRawOne<{ sumSqm: string; sumSqmOfr: string }>();

      const inSqm = Number(agg?.sumSqm ?? 0);
      const inSqmOFR = Number(agg?.sumSqmOfr ?? 0);

      (batch as any).in = parseFloat(inSqm.toFixed(4));
      (batch as any).inOFR = parseFloat(inSqmOFR.toFixed(4));

      (batch as any).balance = parseFloat(
        (Number((batch as any).start ?? 0) + Number((batch as any).in ?? 0) - Number((batch as any).out ?? 0)).toFixed(4),
      );
      (batch as any).balanceOFR = parseFloat(
        (Number((batch as any).startOFR ?? 0) + Number((batch as any).inOFR ?? 0) - Number((batch as any).outOFR ?? 0)).toFixed(4),
      );

      await this.itemBatchRepo.save(batch);
    }

    // 3) recalc itemVariant totals from batches
    const affectedVariantIds = Array.from(variantIdSet);

    for (const variantId of affectedVariantIds) {
      const variant = await this.variantRepo.findOne({
        where: { id: variantId } as any,
        relations: ['batches'],
      });
      if (!variant) continue;

      let totalStart = 0,
        totalIn = 0,
        totalOut = 0;
      let totalStartOFR = 0,
        totalInOFR = 0,
        totalOutOFR = 0;

      for (const b of (variant as any).batches || []) {
        totalStart += Number((b as any).start ?? 0);
        totalIn += Number((b as any).in ?? 0);
        totalOut += Number((b as any).out ?? 0);

        totalStartOFR += Number((b as any).startOFR ?? 0);
        totalInOFR += Number((b as any).inOFR ?? 0);
        totalOutOFR += Number((b as any).outOFR ?? 0);
      }

      (variant as any).totalStart = parseFloat(totalStart.toFixed(4));
      (variant as any).totalIn = parseFloat(totalIn.toFixed(4));
      (variant as any).totalOut = parseFloat(totalOut.toFixed(4));
      (variant as any).totalBalance = parseFloat((totalStart + totalIn - totalOut).toFixed(4));

      (variant as any).totalStartOFR = parseFloat(totalStartOFR.toFixed(4));
      (variant as any).totalInOFR = parseFloat(totalInOFR.toFixed(4));
      (variant as any).totalOutOFR = parseFloat(totalOutOFR.toFixed(4));
      (variant as any).totalBalanceOFR = parseFloat((totalStartOFR + totalInOFR - totalOutOFR).toFixed(4));

      await this.variantRepo.save(variant);
    }
  }

  // ────────────────────────────────────────────────────────────
  // JV creation (typed fixes applied)
  // ────────────────────────────────────────────────────────────
private async createOrRebuildJVForPurchaseInvoice(
  invoice: PurchaseInvoice,
  items: PurchaseInvoiceItem[],
  unitPriceRows: any[] | undefined,
) {
  if (
    (invoice as any).status !== 'Recieved' ||
    !['G', 'S', 'SR', 'PR'].includes((invoice as any).type as any)
  ) {
    return;
  }

  const isPR = (invoice as any).type === 'PR';
  const effectiveType = isPR ? ((invoice as any).returnBaseType ?? 'S') : (invoice as any).type;

  // Resolve the correct account based on invoice type
  const expenseAcct = await this.accountingResolver.resolveAccount(
    isPR ? 'PurchasesReturn_USD' : 'Purchases_USD',
    null,
  );

  let normalTotal = 0;
  let ofrTotal = 0;

  if (effectiveType === 'G') {
    for (const row of items as any[]) ofrTotal += Number(row.totalOFR ?? 0);
  } else if (effectiveType === 'S') {
    for (const row of items as any[]) {
      normalTotal += Number(row.totalAmount ?? 0);
      ofrTotal += Number(row.totalAmount ?? 0);
    }
  } else {
    for (const row of items as any[]) {
      normalTotal += Number(row.totalAmount ?? 0);
      ofrTotal += Number(row.totalOFR ?? 0);
    }
  }

  const rate = Number((invoice as any).exchangeRate ?? 1);
  const invoiceCurrency = String((invoice as any).currency || 'USD').toUpperCase();
  const normalLL = normalTotal * rate;
  const ofrLL = ofrTotal * rate;

  const jvNumber = (invoice as any).invoiceNumber;

  // Fetch supplier name for JV descriptions
  const invoiceWithSupplier = await this.invoiceRepo.findOne({
    where: { id: (invoice as any).id } as any,
    relations: ['supplier'],
  });
  const supplierName = (invoiceWithSupplier as any)?.supplier?.supplierName || '';
  const supplierInvNb = String((invoice as any).supplierInvoiceNumber || '').trim();
  const hdrDebitDesc = `فاتورة شراء - رقم ${supplierInvNb}${supplierName ? ' - ' + supplierName : ''}`;
  const hdrCreditDesc = `فاتورة شراء - رقم ${supplierInvNb}`;

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

  if (effectiveType === 'G') {
    hdrDrOFR = ofrTotal;
    hdrDrUSDOFR = ofrTotal;
    hdrDrLLOFR = ofrLL;

    hdrCrOFR = ofrTotal;
    hdrCrUSDOFR = ofrTotal;
    hdrCrLLOFR = ofrLL;
  } else if (effectiveType === 'S') {
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

  // Apply VAT percentage to both the purchases DR and supplier CR lines
  const vatPct = Number((invoice as any).vatPercent ?? 0);
  if (vatPct > 0) {
    let vatNormal = 0, vatOFR = 0;
    if (effectiveType === 'G') {
      vatOFR = ofrTotal * (vatPct / 100);
    } else if (effectiveType === 'S') {
      vatNormal = normalTotal * (vatPct / 100);
      vatOFR = normalTotal * (vatPct / 100);
    } else {
      vatNormal = normalTotal * (vatPct / 100);
      vatOFR = ofrTotal * (vatPct / 100);
    }
    const vatNormalLL = vatNormal * rate;
    const vatOFRLL = vatOFR * rate;

    hdrDr += vatNormal;      hdrDrUSD += vatNormal;      hdrDrLL += vatNormalLL;
    hdrDrOFR += vatOFR;     hdrDrUSDOFR += vatOFR;     hdrDrLLOFR += vatOFRLL;
    hdrCr += vatNormal;      hdrCrUSD += vatNormal;      hdrCrLL += vatNormalLL;
    hdrCrOFR += vatOFR;     hdrCrUSDOFR += vatOFR;     hdrCrLLOFR += vatOFRLL;
  }

  // For PR (purchase return): DR side is supplier (reduces payable), CR side is expense account
  const debitAccountId = isPR ? null : (expenseAcct as any).id;
  const debitSupplierId = isPR ? (invoice as any).supplierId : null;
  const creditAccountId = isPR ? (expenseAcct as any).id : null;
  const creditSupplierId = isPR ? null : (invoice as any).supplierId;

const debitLine = this.journalVoucherDetailRepo.create(
  {
    accountId: debitAccountId,
    supplierId: debitSupplierId,
    description: hdrDebitDesc,
    docNbr: jvNumber,
    currency: invoiceCurrency,
    exRateUSD: rate,

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
  } as DeepPartial<JournalVoucherDetail>,
);

const creditLine = this.journalVoucherDetailRepo.create(
  {
    accountId: creditAccountId,
    supplierId: creditSupplierId,
    description: hdrCreditDesc,
    docNbr: jvNumber,
    currency: invoiceCurrency,
    exRateUSD: rate,

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
  } as DeepPartial<JournalVoucherDetail>,
);


  const extraJVDetails: JournalVoucherDetail[] = [];

  if (unitPriceRows?.length) {
    type CreditGroup = {
      creditAccountId: number | null;
      creditSupplierId: number | null;
      cr: number; crUSD: number; crLL: number;
      crOFR: number; crUSDOFR: number; crLLOFR: number;
    };
    const creditGroups = new Map<string, CreditGroup>();

    for (const row of unitPriceRows as any[]) {
      // Resolve charge account and tax (supplier of tax) fields
      const chargeAccountId: number | null = row.accountId ?? row.account?.id ?? null;

      const taxAccountId: number | null =
        row.taxAccountId != null ? Number(row.taxAccountId)
        : row.taxAccount?.id != null ? Number(row.taxAccount.id)
        : null;

      const taxSupplierId: number | null =
        row.taxSupplierId != null ? Number(row.taxSupplierId)
        : row.taxSupplier?.id != null ? Number(row.taxSupplier.id)
        : null;

      const creditAccountId: number | null = taxAccountId;
      const creditSupplierId: number | null = creditAccountId ? null : (taxSupplierId ?? null);

      // Skip row if charge account or supplier of tax is missing
      if (!chargeAccountId || (creditAccountId == null && creditSupplierId == null)) {
        continue;
      }

      const value = Number(row.value || 0);
      const valueOFR = Number(row.valueOFR || 0);
      const valueLL = value * rate;
      const valueOFRLL = valueOFR * rate;

      let dr = 0, drUSD = 0, drLL = 0, drOFR = 0, drUSDOFR = 0, drLLOFR = 0;
      let cr = 0, crUSD = 0, crLL = 0, crOFR = 0, crUSDOFR = 0, crLLOFR = 0;

      if (effectiveType === 'G') {
        drOFR = valueOFR; drUSDOFR = valueOFR; drLLOFR = valueOFRLL;
        crOFR = valueOFR; crUSDOFR = valueOFR; crLLOFR = valueOFRLL;
      } else if (effectiveType === 'S') {
        dr = value; drUSD = value; drLL = valueLL;
        drOFR = value; drUSDOFR = value; drLLOFR = valueLL;
        cr = value; crUSD = value; crLL = valueLL;
        crOFR = value; crUSDOFR = value; crLLOFR = valueLL;
      } else if (effectiveType === 'SR') {
        dr = value; drUSD = value; drLL = valueLL;
        drOFR = valueOFR; drUSDOFR = valueOFR; drLLOFR = valueOFRLL;
        cr = value; crUSD = value; crLL = valueLL;
        crOFR = valueOFR; crUSDOFR = valueOFR; crLLOFR = valueOFRLL;
      }

      // One debit line per charge row
      const rowChargeName = String(row.chargeName || '').trim();
      const rowNbTax = String(row.invoiceNbTax || '').trim();
      const debitDesc = ['Expense invoice', rowChargeName, rowNbTax].filter(Boolean).join(' - ');

      const drLine = this.journalVoucherDetailRepo.create({
        accountId: chargeAccountId,
        description: debitDesc,
        docNbr: jvNumber,
        currency: invoiceCurrency,
        exRateUSD: rate,
        dr, drUSD, drLL, drOFR, drUSDOFR, drLLOFR,
        cr: 0, crUSD: 0, crLL: 0, crOFR: 0, crUSDOFR: 0, crLLOFR: 0,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      } as DeepPartial<JournalVoucherDetail>);

      extraJVDetails.push(drLine);

      // Group credit lines: key includes nbTax only when it is present
      const groupKey = rowNbTax
        ? `${rowNbTax}|${creditAccountId ?? ''}|${creditSupplierId ?? ''}`
        : `|${creditAccountId ?? ''}|${creditSupplierId ?? ''}`;

      if (creditGroups.has(groupKey)) {
        const g = creditGroups.get(groupKey)!;
        g.cr += cr; g.crUSD += crUSD; g.crLL += crLL;
        g.crOFR += crOFR; g.crUSDOFR += crUSDOFR; g.crLLOFR += crLLOFR;
      } else {
        creditGroups.set(groupKey, {
          creditAccountId, creditSupplierId,
          cr, crUSD, crLL, crOFR, crUSDOFR, crLLOFR,
        });
      }
    }

    // One credit line per group (summed)
    for (const [, g] of creditGroups) {
      const crLine = this.journalVoucherDetailRepo.create({
        accountId: g.creditAccountId,
        supplierId: g.creditSupplierId,
        description: 'Payable invoice',
        docNbr: jvNumber,
        currency: invoiceCurrency,
        exRateUSD: rate,
        dr: 0, drUSD: 0, drLL: 0, drOFR: 0, drUSDOFR: 0, drLLOFR: 0,
        cr: g.cr, crUSD: g.crUSD, crLL: g.crLL,
        crOFR: g.crOFR, crUSDOFR: g.crUSDOFR, crLLOFR: g.crLLOFR,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      } as DeepPartial<JournalVoucherDetail>);

      extraJVDetails.push(crLine);
    }
  }

  const jv = this.journalVoucherRepo.create({
    jvNumber,
    purchaseInvoiceId: (invoice as any).id,
    date: (invoice as any).jvDate,
    jvType: isPR ? 'PR' : (invoice as any).type,

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
  } as any);

  await this.journalVoucherRepo.save(jv);
}





  private async getActiveYearYY(): Promise<string> {
  const setting = await this.settingsRepo.findOne({ where: { isActive: true } as any });
  if (!setting?.year) throw new Error('Active year not found in settings');
  return String(setting.year).slice(-2);
}

private async getNextPurchaseInvoiceNumber(type: 'S' | 'G' | 'SR' | 'RVR'): Promise<string> {
  const yy = await this.getActiveYearYY();

  // If you want G to have its own series, keep PVG. If you want ALL types to be PV, replace with: `PV${yy}-`
  const prefix = type === 'G' ? `PVG${yy}-` : `PV${yy}-`;

  const last = await this.invoiceRepo
    .createQueryBuilder('pi')
    .select(['pi.id', 'pi.invoiceNumber'])
    .where('pi.invoiceNumber LIKE :p', { p: `${prefix}%` })
    .orderBy('pi.id', 'DESC')
    .getOne();

  let lastSeq = 0;
  if (last?.invoiceNumber?.startsWith(prefix)) {
    const part = last.invoiceNumber.replace(prefix, ''); // "001"
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) lastSeq = n;
  }

  const nextSeq = lastSeq + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`; // PV25-001
}

  // ────────────────────────────────────────────────────────────
  // CREATE (no recompute functions, no applyPurchaseCostsForInvoice)
  // ────────────────────────────────────────────────────────────
async create(data: Partial<PurchaseInvoice>) {
  const type = (data as any).type ?? 'S';
  (data as any).supplierInvoiceNumber = (data as any).invoiceNumber ?? null;
  (data as any).invoiceNumber = await this.getNextPurchaseInvoiceNumber(type);
  if ((data as any).etd === '' || (data as any).etd === undefined) (data as any).etd = null;

  // 1) save invoice + items
  const invoice = this.invoiceRepo.create(data as any);
  const savedInvoice = await this.invoiceRepo.save(invoice as any);

  // 2) record inventory tx + batch updates + variant totals
  if ((savedInvoice as any).status === 'Recieved') {
    const invTxs: InventoryTransaction[] = [];
    const invoiceDate = new Date((savedInvoice as any).date);

    for (const item of (((savedInvoice as any).items ?? []) as any[])) {
      let qty = Number(item.quantity ?? 0);
      let sqm = Number(item.sqm ?? 0);

      let qtyOfr = 0;
      let sqmOfr = 0;

      switch ((savedInvoice as any).type) {
        case 'S':
        case 'SR':
          qtyOfr = qty;
          sqmOfr = sqm;
          break;
        case 'G':
          qtyOfr = qty;
          sqmOfr = Number((item as any).sqmOfr ?? 0);
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

      const condition = item.condition || 'Clean';
      const dateReceived = null;
      const warehouse = (savedInvoice as any).warehouse ?? 'Shamoun';

      let itemBatch: ItemBatch | null = await this.itemBatchRepo.findOne({
        where: {
          itemVariant: { id: item.itemVariantId },
          condition,
          dateReceived,
          warehouse,
        } as any,
        relations: ['itemVariant'],
      });

      if (!itemBatch) {
        const newBatch = this.itemBatchRepo.create();

        Object.assign(newBatch, {
          itemVariant: { id: item.itemVariantId } as any,
          condition,
          dateReceived: null,
          warehouse,

          start: 0,
          in: 0,
          out: 0,
          balance: 0,

          startOFR: 0,
          inOFR: 0,
          outOFR: 0,
          balanceOFR: 0,
        });

        itemBatch = await this.itemBatchRepo.save(newBatch);
      }

      const tx = this.inventoryTxRepo.create(
        {
          itemVariantId: item.itemVariantId,
          itemBatchId: (itemBatch as any).id,
          transactionType: 'purchase',

          quantity: qty,
          sqm: sqm,
          quantityofr: qtyOfr,
          sqmofr: sqmOfr,

          finalcost: Number(item.finalCost ?? 0),
          finalcostofr: Number(item.finalOFR ?? 0),

          purchaseInvoiceItemId: item.id,
          invoiceItemId: null,
          transferId: null,
          inventoryCountId: null,

          dateForEachInvoice: invoiceDate,
        } as DeepPartial<InventoryTransaction>,
      );

      invTxs.push(tx);
    }

    if (invTxs.length) {
      await this.inventoryTxRepo.save(invTxs);
    }

    // rebuild batches + variant totals based on tx
    await this.rebuildInventoryForPurchaseInvoice(
      { ...(savedInvoice as any), items: (savedInvoice as any).items } as any,
      [],
    );

    // JV
    await this.createOrRebuildJVForPurchaseInvoice(
      savedInvoice as any,
      (((savedInvoice as any).items ?? []) as any),
      (data as any)?.unitPriceRows,
    );

    // ✅ unit price rows (NOW also persists taxAccount / taxSupplier correctly)
    if ((data as any)?.unitPriceRows?.length) {
      const normalized = (data as any).unitPriceRows.map((r: any) => {
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

        const taxAccountId =
          row.taxAccountId != null
            ? Number(row.taxAccountId)
            : row.taxAccount?.id != null
            ? Number(row.taxAccount.id)
            : null;

        const taxSupplierId =
          row.taxSupplierId != null
            ? Number(row.taxSupplierId)
            : row.taxSupplier?.id != null
            ? Number(row.taxSupplier.id)
            : null;

        return this.rowRepo.create({
          invoice: { id: (savedInvoice as any).id } as any,
          invoiceId: (savedInvoice as any).id,

          purchaseInvoiceSettingId: row.purchaseInvoiceSettingId ?? null,
          chargeName: row.chargeName,
          chargeType: row.chargeType,
          value: Number(row.value ?? 0),
          valueOFR: Number(row.valueOFR ?? 0),
          currency: row.currency,
          valueExch: Number(row.valueExch ?? 0),
          valueExchOFR: Number(row.valueExchOFR ?? 0),

          addToItemCost: row.addToItemCost,
invoiceNbTax: this.intOrNull(row.invoiceNbTax),
          supplierId,
          accountId,
          shipping: row.shipping,

          // ✅ NEW: SAVE RELATIONS (so FK persists even if taxAccountId property isn't declared)
          taxAccount: taxAccountId ? ({ id: taxAccountId } as any) : null,
          taxSupplier: taxSupplierId ? ({ id: taxSupplierId } as any) : null,
        } as any);
      });

      await this.rowRepo.save(rowsToSave as any);
    }

    // ✅ compute averages ONLY for this invoice
    await this.computeAndWriteCostsForInvoice((savedInvoice as any).id);
  }

  return savedInvoice;
}

  // ────────────────────────────────────────────────────────────
  // PURCHASE RETURN
  // ────────────────────────────────────────────────────────────
async createPurchaseReturn(data: any): Promise<PurchaseInvoice> {
  const baseType: 'S' | 'G' | 'SR' = (data.baseType as any) ?? 'S';
  const yy = await this.getActiveYearYY();

  const prefix = baseType === 'G' ? `PVGR${yy}-` : `PVR${yy}-`;

  const last = await this.invoiceRepo
    .createQueryBuilder('pi')
    .select(['pi.id', 'pi.invoiceNumber'])
    .where('pi.invoiceNumber LIKE :p', { p: `${prefix}%` })
    .orderBy('pi.id', 'DESC')
    .getOne();

  let lastSeq = 0;
  if (last?.invoiceNumber?.startsWith(prefix)) {
    const part = last.invoiceNumber.replace(prefix, '');
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) lastSeq = n;
  }
  const nextSeq = lastSeq + 1;
  const invoiceNumber = `${prefix}${String(nextSeq).padStart(3, '0')}`;

  (data as any).supplierInvoiceNumber = (data as any).invoiceNumber ?? null;
  (data as any).invoiceNumber = invoiceNumber;
  (data as any).type = 'PR';
  (data as any).returnBaseType = baseType;

  const invoice = this.invoiceRepo.create(data as any);
  const savedInvoice = await this.invoiceRepo.save(invoice as any);

  if ((savedInvoice as any).status === 'Recieved') {
    await this.rebuildInventoryForPurchaseInvoice(
      { ...(savedInvoice as any), items: (savedInvoice as any).items } as any,
      [],
    );

    await this.createOrRebuildJVForPurchaseInvoice(
      savedInvoice as any,
      (((savedInvoice as any).items ?? []) as any),
      undefined,
    );
  }

  return savedInvoice;
}

  // ────────────────────────────────────────────────────────────
  // UPDATE (no recompute functions, no applyPurchaseCostsForInvoice)
  // ────────────────────────────────────────────────────────────
async update(id: number, data: Partial<PurchaseInvoice>) {
  const existing = await this.invoiceRepo.findOne({
    where: { id } as any,
    relations: ['items', 'items.itemVariant'],
  });
  if (!existing) throw new NotFoundException(`PurchaseInvoice ${id} not found`);

  const PI_FIELDS = ['date', 'supplierId', 'invoiceType', 'grandTotal', 'currency', 'notes', 'discount'];
  const oldSnapshot = {} as Record<string, any>;
  for (const f of PI_FIELDS) oldSnapshot[f] = (existing as any)[f] ?? null;

  const prevItemIds = (((existing as any).items ?? []) as any[])
    .map((it: any) => Number(it.id))
    .filter((n: number) => Number.isFinite(n) && n > 0);

  // old batch ids from txs (so deleted items batches get fixed)
  let oldBatchIds: number[] = [];
  if (prevItemIds.length) {
    const oldTxs = await this.inventoryTxRepo.find({
      where: { purchaseInvoiceItemId: In(prevItemIds) } as any,
    });
    oldBatchIds = Array.from(
      new Set(
        oldTxs
          .map((tx: any) => Number(tx.itemBatchId))
          .filter((n: number) => Number.isFinite(n) && n > 0),
      ),
    );
  }

  const {
    items: incomingItemsPayload,
    unitPriceRows: incomingUnitPriceRowsPayload,
    invoiceNumber: _ignoredInvoiceNumber,
    ...headerPayload
  } = (data as any) || {};

  if (headerPayload.etd === "" || headerPayload.etd === undefined) (headerPayload as any).etd = null;
  Object.assign(existing as any, headerPayload);
  (existing as any).unitPriceRows = undefined;

  // upsert items
  const incomingItems = (incomingItemsPayload ?? []).map((it: any) => ({ ...it }));
  const incomingItemIdSet = new Set<number>(
    incomingItems.filter((i: any) => i.id).map((i: any) => Number(i.id)),
  );

  const toDeleteItemIds = prevItemIds.filter((oldId) => !incomingItemIdSet.has(oldId));

  if (toDeleteItemIds.length) {
    await this.inventoryTxRepo.delete({ purchaseInvoiceItemId: In(toDeleteItemIds) } as any);
    await this.itemRepo.delete(toDeleteItemIds as any);
  }

  for (const raw of incomingItems) {
    if (raw.id) {
      await this.itemRepo.update(raw.id, { ...raw, invoiceId: (existing as any).id } as any);
    } else {
      const created = this.itemRepo.create({
        ...raw,
        invoice: { id: (existing as any).id } as any,
        invoiceId: (existing as any).id,
      } as any);
      await this.itemRepo.save(created as any);
    }
  }

  // reload items
  (existing as any).items = await this.itemRepo.find({
    where: { invoice: { id: (existing as any).id } } as any,
  });

  // save header
  const savedInvoice = await this.invoiceRepo.save(existing as any);

  // delete ALL old txs for previous items (safe)
  if (prevItemIds.length) {
    await this.inventoryTxRepo.delete({ purchaseInvoiceItemId: In(prevItemIds) } as any);
  }

  // rebuild inventory tx/batches/variant totals for updated invoice
  await this.rebuildInventoryForPurchaseInvoice(
    { ...(savedInvoice as any), items: (existing as any).items } as any,
    oldBatchIds,
  );

  // rebuild JV (delete old, recreate)
  const existingJvs = await this.journalVoucherRepo.find({
    where: { purchaseInvoiceId: (savedInvoice as any).id } as any,
  });

  if (existingJvs.length) {
    const jvIds = existingJvs
      .map((j: any) => Number(j.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (jvIds.length) {
      await this.journalVoucherDetailRepo.delete({ journalVoucherId: In(jvIds) } as any);
      await this.journalVoucherRepo.delete({ id: In(jvIds) } as any);
    }
  }

  await this.createOrRebuildJVForPurchaseInvoice(
    { ...(savedInvoice as any), items: (existing as any).items } as any,
    (existing as any).items,
    incomingUnitPriceRowsPayload,
  );

  // rebuild unit price rows
  await this.rowRepo.delete({ invoiceId: (savedInvoice as any).id } as any);

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

      const taxAccountId =
        row.taxAccountId != null
          ? Number(row.taxAccountId)
          : row.taxAccount?.id != null
          ? Number(row.taxAccount.id)
          : null;

      const taxSupplierId =
        row.taxSupplierId != null
          ? Number(row.taxSupplierId)
          : row.taxSupplier?.id != null
          ? Number(row.taxSupplier.id)
          : null;

      const { id: _rowId, account, supplier, taxAccount, taxSupplier, ...rest } = row;

      return this.rowRepo.create({
        invoice: { id: (savedInvoice as any).id } as any,
        invoiceId: (savedInvoice as any).id,

        purchaseInvoiceSettingId: rest.purchaseInvoiceSettingId ?? null,
        chargeName: rest.chargeName,
        chargeType: rest.chargeType,
        value: Number(rest.value ?? 0),
        valueOFR: Number(rest.valueOFR ?? 0),
        currency: rest.currency,
        valueExch: Number(rest.valueExch ?? 0),
        valueExchOFR: Number(rest.valueExchOFR ?? 0),
        addToItemCost: rest.addToItemCost,
        invoiceNbTax: this.intOrNull(row.invoiceNbTax),
        shipping: rest.shipping,

        accountId,
        supplierId,

        // ✅ NEW: SAVE RELATIONS (so FK persists even if taxAccountId property isn't declared)
        taxAccount: taxAccountId ? ({ id: taxAccountId } as any) : null,
        taxSupplier: taxSupplierId ? ({ id: taxSupplierId } as any) : null,
      } as any);
    });

    await this.rowRepo.save(rowsToSave as any);
  }

  // ✅ compute averages ONLY for this invoice (no chain recompute)
  await this.computeAndWriteCostsForInvoice((savedInvoice as any).id);

  const _changes = computeDiff(oldSnapshot, savedInvoice as any, PI_FIELDS);
  return Object.keys(_changes).length
    ? Object.assign(savedInvoice as any, { _changes })
    : savedInvoice;
}


  // ────────────────────────────────────────────────────────────
  // READS
  // ────────────────────────────────────────────────────────────
  async findAll() {
    return this.invoiceRepo.find({
      relations: [
        'supplier',
        'items',
        'items.itemVariant',
        'unitPriceRows',
        'unitPriceRows.purchaseInvoiceSetting',
      ] as any,
    });
  }

 async findOne(id: number) {
  return this.invoiceRepo.findOne({
    where: { id } as any,
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

      // ✅ NEW
      'unitPriceRows.taxAccount',
      'unitPriceRows.taxSupplier',
    ] as any,
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

  // ────────────────────────────────────────────────────────────
  // Controller-required methods (your TS errors)
  // ────────────────────────────────────────────────────────────
async getCostAnalysisHistory(q?: any): Promise<any[]> {
  // q can be a plain search string from the controller
  const searchText = typeof q === 'string' ? q.trim() : null;
  const tokens = searchText
    ? searchText.split(/\s+/).filter(Boolean)
    : [];

  const variantIdFilter =
    q?.itemVariantId != null
      ? Number(q.itemVariantId)
      : q?.variantId != null
      ? Number(q.variantId)
      : null;

  const qb = this.inventoryTxRepo.createQueryBuilder('tx');

  // ✅ subquery: the source batch (MovedFrom) batchId for the same transfer/date
  const movedFromBatchSub = qb
    .subQuery()
    .select('txo.itemBatchId')
    .from(InventoryTransaction, 'txo')
    .where('txo.transferId = tx.transferId')
    .andWhere(`txo.transactionType = 'MovedFrom'`)
    .andWhere('txo.dateForEachInvoice = tx.dateForEachInvoice')
    .orderBy('txo.id', 'DESC')
    .limit(1)
    .getQuery();

  // normalize location (your “codes” live in location)
  const locExpr = `UPPER(TRIM(tr.location))`;

  qb
    // 🔹 join purchase invoice items (for purchases)
    .leftJoin(PurchaseInvoiceItem, 'pii', 'pii.id = tx.purchaseInvoiceItemId')

    // 🔹 join transfer header (for JF/BOSTS detection)
    .leftJoin(Transfer, 'tr', 'tr.id = tx.transferId')

    // 🔹 join transfer items (for transfers)
    // ✅ IMPORTANT: do NOT join by itemVariantId (it is NULL in your table)
    // Normal transfers: match by tx.itemBatchId
    // Special (JF/BOSTS/FJ): MovedTo should match the MovedFrom batchId
    .leftJoin(
      TransferItem,
      'ti',
      `
      ti.transferId = tx.transferId
      AND (
        (
          ${locExpr} NOT IN ('JF','BOSTS','FJ')
          AND ti.itemBatchId = tx.itemBatchId
        )
        OR
        (
          ${locExpr} IN ('JF','BOSTS','FJ')
          AND tx.transactionType = 'MovedTo'
          AND ti.itemBatchId = (${movedFromBatchSub})
        )
      )
    `,
    )

    // 🔹 join variant → thickness → item
    .leftJoin(ItemVariant, 'iv', 'iv.id = tx.itemVariantId')
    .leftJoin(Thickness, 'th', 'th.id = iv.thicknessId')
    .leftJoin(Item, 'it', 'it.id = th.itemId')

    .select([
      'tx.id AS id',
      'tx.itemVariantId AS itemVariantId',
      'tx.transactionType AS transactionType',
      'tx.transactionDate AS transactionDate',
      'tx.dateForEachInvoice AS dateForEachInvoice',
      'tx.sqm AS sqm',
      'tx.sqmofr AS sqmofr',
      'tx.finalcost AS finalcost',
      'tx.finalcostofr AS finalcostofr',
      'tx.purchaseInvoiceItemId AS purchaseInvoiceItemId',
      'tx.transferId AS transferId',
      'tx.inventoryCountId AS inventoryCountId',
    ])
    .addSelect([
      // metadata
      'it.itemName AS itemName',
      'it.sortIndex AS itemSortIndex',
      'th.thickness AS thickness',
      'th.sort_index AS thicknessSortIndex',
      'iv.length AS length',
      'iv.width AS width',
      'iv.sheetsPerBox AS sheetsPerBox',
      'iv.origin AS origin',
      'iv.invoiceDisplayName AS invoiceDisplayName',

      // helpful: show transfer "code"
      'tr.location AS transferLocation',

      // previous qty (purchase only)
      'pii.previousQuantity AS previousQuantity',
      'pii.previousQuantityC AS previousQuantityC',
      'pii.previousQuantityVM AS previousQuantityVM',
      'pii.previousQuantityCVM AS previousQuantityCVM',

      // previous avg (purchase only)
      'pii.previousAverageCost AS previousAverageCost',
      'pii.previousAverageCostC AS previousAverageCostC',
      'pii.previousAverageCostVM AS previousAverageCostVM',
      'pii.previousAverageCostCVM AS previousAverageCostCVM',

      // running avg (purchase OR transfer)
      'COALESCE(pii.averageCost, ti.averageCost) AS averageCost',
      'COALESCE(pii.averageCostC, ti.averageCostC) AS averageCostC',
      'COALESCE(pii.averageCostVM, ti.averageCostVM) AS averageCostVM',
      'COALESCE(pii.averageCostCVM, ti.averageCostCVM) AS averageCostCVM',

      // purchase-only price info
      'pii.priceOFR AS priceOFR',
      'pii.finalOFR AS finalOFR',
    ])
    .where(
      new Brackets((b) => {
        b.where('tx.purchaseInvoiceItemId IS NOT NULL')
          .orWhere('tx.transferId IS NOT NULL')
          .orWhere('tx.inventoryCountId IS NOT NULL');
      }),
    );

  if (variantIdFilter) {
    qb.andWhere('tx.itemVariantId = :id', { id: variantIdFilter });
  }

  // Text search: each token must appear in the item name (Arabic-normalized)
  tokens.forEach((tok, idx) => {
    const like = `%${tok}%`;
    qb.andWhere(
      `(REPLACE(REPLACE(REPLACE(it.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx} OR it.itemName LIKE :tokR${idx})`,
      { [`tokN${idx}`]: like, [`tokR${idx}`]: like },
    );
  });

  return qb
    .orderBy('it.sortIndex', 'ASC')
    .addOrderBy('th.sort_index', 'ASC')
    .addOrderBy('iv.id', 'ASC')
    .addOrderBy('tx.dateForEachInvoice', 'ASC')
    .addOrderBy('tx.transactionDate', 'ASC')
    .addOrderBy('tx.id', 'ASC')
    .getRawMany();
}





  async getRealDescriptionCostHistory(q?: any): Promise<any[]> {
    const descId = Number(q?.itemNameDescriptionId || q?.descriptionId || 0);
    if (!descId) return [];

    const variants = await this.variantRepo.find({
      where: { itemNameDescriptionId: descId } as any,
      select: ['id'] as any,
    });

    const variantIds = variants
      .map((v: any) => Number(v.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (!variantIds.length) return [];

    return this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select([
        'tx.id AS id',
        'tx.itemVariantId AS itemVariantId',
        'tx.transactionType AS transactionType',
        'tx.transactionDate AS transactionDate',
        'tx.dateForEachInvoice AS dateForEachInvoice',
        'tx.sqm AS sqm',
        'tx.sqmofr AS sqmofr',
        'tx.finalcost AS finalcost',
        'tx.finalcostofr AS finalcostofr',
        'tx.purchaseInvoiceItemId AS purchaseInvoiceItemId',
        'tx.transferId AS transferId',
        'tx.inventoryCountId AS inventoryCountId',
      ])
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIds })
      .andWhere(
        new Brackets((b) => {
          b.where('tx.purchaseInvoiceItemId IS NOT NULL')
            .orWhere('tx.transferId IS NOT NULL')
            .orWhere('tx.inventoryCountId IS NOT NULL');
        }),
      )
      .orderBy('tx.dateForEachInvoice', 'ASC')
      .addOrderBy('tx.transactionDate', 'ASC')
      .addOrderBy('tx.id', 'ASC')
      .getRawMany();
  }


  
typescript// Add this method to your PurchaseInvoiceService class

/**
 * Get journal voucher(s) with details for a specific purchase invoice
 */
async getJournalVouchersForInvoice(purchaseInvoiceId: number) {
  // First verify the purchase invoice exists
  const invoice = await this.invoiceRepo.findOne({
    where: { id: purchaseInvoiceId } as any,
  });

  if (!invoice) {
    throw new NotFoundException(
      `Purchase invoice with ID ${purchaseInvoiceId} not found`,
    );
  }

  // Get all journal vouchers for this purchase invoice with their details
  const journalVouchers = await this.journalVoucherRepo.find({
    where: { purchaseInvoiceId } as any,
    relations: [
      'details',
      'details.account',
      'details.supplier',
      'details.customer',
      'details.exchangeRateAcc',
      'details.exchangeRateUSD',
      'exchangeRateAcc',
      'exchangeRateUSD',
    ],
    order: {
      date: 'DESC',
      id: 'DESC',
    } as any,
  });

  return {
    purchaseInvoice: {
      id: (invoice as any).id,
      invoiceNumber: (invoice as any).invoiceNumber,
      date: (invoice as any).date,
      type: (invoice as any).type,
      status: (invoice as any).status,
    },
    journalVouchers: journalVouchers.map((jv) => ({
      id: (jv as any).id,
      date: (jv as any).date,
      jvNumber: (jv as any).jvNumber,
      jvType: (jv as any).jvType,
      totalDr: (jv as any).totalDr,
      totalDrUSD: (jv as any).totalDrUSD,
      totalDrLL: (jv as any).totalDrLL,
      totalDrOFR: (jv as any).totalDrOFR,
      totalDrUSDOFR: (jv as any).totalDrUSDOFR,
      totalDrLLOFR: (jv as any).totalDrLLOFR,
      totalCr: (jv as any).totalCr,
      totalCrUSD: (jv as any).totalCrUSD,
      totalCrLL: (jv as any).totalCrLL,
      totalCrOFR: (jv as any).totalCrOFR,
      totalCrUSDOFR: (jv as any).totalCrUSDOFR,
      totalCrLLOFR: (jv as any).totalCrLLOFR,
      exchangeRateAcc: (jv as any).exchangeRateAcc,
      exchangeRateUSD: (jv as any).exchangeRateUSD,
      details: ((jv as any).details || []).map((detail: any) => ({
        id: detail.id,
        accountId: detail.accountId,
        account: detail.account
          ? {
              id: detail.account.id,
              name: detail.account.name,
              code: detail.account.code,
              accountNumber: detail.account.accountNumber,
            }
          : null,
        supplierId: detail.supplierId,
        supplier: detail.supplier
          ? {
              id: detail.supplier.id,
              name: detail.supplier.name,
              supplierName: detail.supplier.supplierName,
            }
          : null,
        customerId: detail.customerId,
        customer: detail.customer
          ? {
              id: detail.customer.id,
              customerName: detail.customer.customerName,
            }
          : null,
        description: detail.description,
        check: detail.check,
        checkDate: detail.checkDate,
        bankName: detail.bankName,
        dr: detail.dr,
        drUSD: detail.drUSD,
        drLL: detail.drLL,
        drOFR: detail.drOFR,
        drUSDOFR: detail.drUSDOFR,
        drLLOFR: detail.drLLOFR,
        cr: detail.cr,
        crUSD: detail.crUSD,
        crLL: detail.crLL,
        crOFR: detail.crOFR,
        crUSDOFR: detail.crUSDOFR,
        crLLOFR: detail.crLLOFR,
        currency: detail.currency,
        exRateEUROToUSD: detail.exRateEUROToUSD,
        exRateUSD: detail.exRateUSD,
        docNbr: detail.docNbr,
        exchangeRateAcc: detail.exchangeRateAcc,
        exchangeRateUSD: detail.exchangeRateUSD,
      })),
    })),
  };
}
}
