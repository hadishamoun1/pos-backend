// Loss Report: stock thrown away or broken, valued at OFR cost on the day it
// happened.
//   SQM trash   — SqmTrash / SqmTrashRestore (SQM page), valued at the cost of
//                 the box/sheet the piece was cut from (BOSTS transfer line)
//   Cuts loss   — 'Cuts Loss' (leftover of a sold cut, Cuts Control)
//   Breakage    — 'Breakage' from an Inventory Check, or a Breakage transfer
//   Defects     — 'Defects' transfer
// Cost per sqm (or per piece for unit items) = the item's last purchase or
// count on or before that date (purchase line averageCost / count
// finalCostOfr); sheets are valued at their box's cost. Saved costs on these
// movements aren't used — Inventory Check breakage saves 0, and SQM trash
// saves the SQM item's average rather than its source's.
import { DataSource } from 'typeorm';

export type LossCategory = 'sqmTrash' | 'cutsLoss' | 'breakage' | 'defects';

export const LOSS_CATEGORY_LABEL: Record<LossCategory, string> = {
  sqmTrash: 'SQM trash',
  cutsLoss: 'Cuts loss',
  breakage: 'Breakage',
  defects: 'Defects',
};

const ymd = (d: any): string => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const inList = (ids: number[]) => ids.map(() => '?').join(',');

export async function buildLossReport(
  ds: DataSource,
  params: { from: string; to: string; category?: string },
) {
  const { from, to } = params;
  const category = params.category && params.category !== 'all' ? params.category : null;

  // 1) The loss movements in range.
  const txs: any[] = await ds.query(
    `SELECT tx.id, tx.transactionType AS tt, tx.dateForEachInvoice AS d,
            tx.itemVariantId AS variantId, tx.itemBatchId AS batchId,
            tx.quantityofr AS qofr, tx.sqmofr AS sqmofr,
            tx.transferId, tx.sqmSourceTransferItemId AS srcTiId,
            tr.transferNumber, tr.location
       FROM inventory_transaction tx
       LEFT JOIN transfers tr ON tr.id = tx.transferId
      WHERE tx.transactionType IN ('SqmTrash','SqmTrashRestore','Breakage','Defects','Cuts Loss')
        AND tx.dateForEachInvoice BETWEEN ? AND ?
      ORDER BY tx.dateForEachInvoice, tx.id`,
    [from, to],
  );

  const categoryOf = (tt: string): LossCategory =>
    tt === 'SqmTrash' || tt === 'SqmTrashRestore'
      ? 'sqmTrash'
      : tt === 'Cuts Loss'
      ? 'cutsLoss'
      : tt === 'Defects'
      ? 'defects'
      : 'breakage';

  const rowsIn = txs.filter((t) => !category || categoryOf(t.tt) === category);
  if (!rowsIn.length) return { from, to, rows: [], totals: [], grandTotal: 0 };

  // 2) SQM trash without a recorded source: find it from the pieces of that
  //    SQM pile. One source (or one source with trash) → exact; otherwise
  //    the source with the most trash, marked estimated.
  const sqmNoSrc = rowsIn.filter((t) => categoryOf(t.tt) === 'sqmTrash' && !t.srcTiId && t.batchId);
  const pileSources = new Map<number, { tiId: number; trashed: number }[]>();
  if (sqmNoSrc.length) {
    const batchIds = Array.from(new Set(sqmNoSrc.map((t) => Number(t.batchId))));
    const pieceRows: any[] = await ds.query(
      `SELECT p.sqmBatchId AS batchId, p.transferItemId AS tiId,
              SUM(p.sqmTrash) + MAX(COALESCE(ti.sqmTrashUnallocated, 0)) AS trashed
         FROM sqm_pieces p
         LEFT JOIN transfer_items ti ON ti.id = p.transferItemId
        WHERE p.sqmBatchId IN (${inList(batchIds)})
        GROUP BY p.sqmBatchId, p.transferItemId`,
      batchIds,
    );
    for (const r of pieceRows) {
      const list = pileSources.get(Number(r.batchId)) ?? [];
      list.push({ tiId: Number(r.tiId), trashed: num(r.trashed) });
      pileSources.set(Number(r.batchId), list);
    }
  }
  const sourceFor = (t: any): { tiId: number | null; estimated: boolean } => {
    if (t.srcTiId) return { tiId: Number(t.srcTiId), estimated: false };
    const list = pileSources.get(Number(t.batchId)) ?? [];
    if (!list.length) return { tiId: null, estimated: false };
    if (list.length === 1) return { tiId: list[0].tiId, estimated: false };
    const withTrash = list.filter((s) => s.trashed > 0);
    if (withTrash.length === 1) return { tiId: withTrash[0].tiId, estimated: false };
    const pool = withTrash.length ? withTrash : list;
    const best = pool.reduce((a, b) => (b.trashed > a.trashed ? b : a));
    return { tiId: best.tiId, estimated: true };
  };

  const resolved = rowsIn.map((t) => {
    const cat = categoryOf(t.tt);
    const src = cat === 'sqmTrash' ? sourceFor(t) : { tiId: null, estimated: false };
    return { t, cat, src };
  });

  // 3) Source transfer lines → the box/sheet the SQM was cut from.
  const tiIds = Array.from(new Set(resolved.map((r) => r.src.tiId).filter((n): n is number => !!n)));
  const tiInfo = new Map<number, { variantId: number; transferNumber: string | null }>();
  if (tiIds.length) {
    const rows: any[] = await ds.query(
      `SELECT ti.id, b.itemVariantId AS variantId, tr.transferNumber
         FROM transfer_items ti
         JOIN item_batch b ON b.id = ti.itemBatchId
         LEFT JOIN transfers tr ON tr.id = ti.transferId
        WHERE ti.id IN (${inList(tiIds)})`,
      tiIds,
    );
    for (const r of rows) tiInfo.set(Number(r.id), { variantId: Number(r.variantId), transferNumber: r.transferNumber });
  }

  // 4) Variant details (lost item, source item, and boxes for sheets).
  const variantIds = new Set<number>();
  for (const r of resolved) {
    variantIds.add(Number(r.t.variantId));
    const s = r.src.tiId ? tiInfo.get(r.src.tiId) : null;
    if (s) variantIds.add(s.variantId);
  }
  const vInfo = new Map<number, any>();
  const loadVariants = async (ids: number[]) => {
    if (!ids.length) return;
    const rows: any[] = await ds.query(
      `SELECT v.id, v.length, v.width, v.sheetsPerBox, v.origin, v.itemNameDescriptionId AS descId,
              v.averageCost, th.thickness, i.itemName, i.type, i.stockMode
         FROM item_variant v
         JOIN thickness th ON th.id = v.thicknessId
         JOIN item i ON i.id = th.itemId
        WHERE v.id IN (${inList(ids)})`,
      ids,
    );
    for (const r of rows) vInfo.set(Number(r.id), r);
  };
  await loadVariants(Array.from(variantIds));

  // Sheets are valued at their box's cost: same description (or item name),
  // thickness, size and origin.
  const sheetToBox = new Map<number, number>();
  const sheets = Array.from(vInfo.values()).filter((v) => String(v.type).toLowerCase() === 'sheet');
  if (sheets.length) {
    const boxes: any[] = await ds.query(
      `SELECT v.id, v.length, v.width, v.origin, v.itemNameDescriptionId AS descId, th.thickness, i.itemName
         FROM item_variant v
         JOIN thickness th ON th.id = v.thicknessId
         JOIN item i ON i.id = th.itemId
        WHERE i.type = 'box'
          AND v.length IN (${inList(sheets)}) AND v.width IN (${inList(sheets)})
        ORDER BY v.id`,
      [...sheets.map((s) => s.length), ...sheets.map((s) => s.width)],
    );
    for (const s of sheets) {
      const match = boxes.find(
        (b) =>
          num(b.length) === num(s.length) &&
          num(b.width) === num(s.width) &&
          num(b.thickness) === num(s.thickness) &&
          String(b.origin || '').trim() === String(s.origin || '').trim() &&
          (s.descId && b.descId ? Number(b.descId) === Number(s.descId) : b.itemName === s.itemName),
      );
      if (match) sheetToBox.set(Number(s.id), Number(match.id));
    }
  }
  const costVariantOf = (vid: number) => sheetToBox.get(vid) ?? vid;

  // 5) Cost events (purchases and counts) for every variant we value by.
  const costIds = Array.from(new Set(resolved.map((r) => {
    const s = r.src.tiId ? tiInfo.get(r.src.tiId) : null;
    return costVariantOf(s ? s.variantId : Number(r.t.variantId));
  })));
  await loadVariants(costIds.filter((id) => !vInfo.has(id)));
  const events: any[] = costIds.length
    ? await ds.query(
        `SELECT tx.itemVariantId AS variantId, tx.dateForEachInvoice AS d, tx.id,
                pii.averageCost AS piiCost, ic.finalCostOfr AS icCost
           FROM inventory_transaction tx
           LEFT JOIN purchase_invoice_items pii ON pii.id = tx.purchaseInvoiceItemId
           LEFT JOIN inventory_count ic ON ic.id = tx.inventoryCountId
          WHERE tx.itemVariantId IN (${inList(costIds)})
            AND tx.dateForEachInvoice <= ?
            AND (tx.purchaseInvoiceItemId IS NOT NULL OR tx.inventoryCountId IS NOT NULL)
          ORDER BY tx.itemVariantId, tx.dateForEachInvoice, tx.id`,
        [...costIds, to],
      )
    : [];
  const eventsByVariant = new Map<number, { d: string; cost: number }[]>();
  for (const e of events) {
    const cost = e.piiCost != null ? num(e.piiCost) : num(e.icCost);
    if (!cost) continue; // a 0 cost never wins — keep looking further back
    const list = eventsByVariant.get(Number(e.variantId)) ?? [];
    list.push({ d: ymd(e.d), cost });
    eventsByVariant.set(Number(e.variantId), list);
  }
  const costAt = (vid: number, date: string): { cost: number; basis: 'event' | 'stored' } => {
    const list = eventsByVariant.get(vid) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].d <= date) return { cost: list[i].cost, basis: 'event' };
    }
    return { cost: num(vInfo.get(vid)?.averageCost), basis: 'stored' };
  };

  const describe = (v: any) =>
    v
      ? {
          variantId: Number(v.id),
          itemName: v.itemName,
          type: v.type,
          thickness: v.thickness != null ? num(v.thickness) : null,
          length: v.length != null ? num(v.length) : null,
          width: v.width != null ? num(v.width) : null,
          sheetsPerBox: v.sheetsPerBox != null ? num(v.sheetsPerBox) : null,
          origin: v.origin ?? null,
        }
      : null;

  // 6) Rows. Restores come back as negative losses.
  const rows = resolved.map(({ t, cat, src }) => {
    const v = vInfo.get(Number(t.variantId));
    const s = src.tiId ? tiInfo.get(src.tiId) : null;
    const valuedVariant = costVariantOf(s ? s.variantId : Number(t.variantId));
    const date = ymd(t.d);
    const isUnit =
      String(v?.type || '').toLowerCase() === 'unit' || String(v?.stockMode || '').toUpperCase() === 'QTY';
    const amount = isUnit ? -num(t.qofr) : -num(t.sqmofr); // + = lost, − = restored
    const { cost, basis } = costAt(valuedVariant, date);
    return {
      txId: Number(t.id),
      date,
      category: cat,
      categoryLabel: LOSS_CATEGORY_LABEL[cat],
      isRestore: t.tt === 'SqmTrashRestore',
      fromInventoryCheck: cat === 'breakage' && !t.transferId,
      transferNumber: t.transferNumber || null,
      item: describe(v),
      source: s ? { ...describe(vInfo.get(s.variantId)), transferNumber: s.transferNumber } : null,
      sourceEstimated: src.estimated,
      valuedAsBox: valuedVariant !== (s ? s.variantId : Number(t.variantId)),
      unit: isUnit ? 'pcs' : 'sqm',
      amount: Number(amount.toFixed(4)),
      costPerUnit: Number(cost.toFixed(4)),
      costBasis: basis, // 'stored' = no purchase/count before this date
      total: Number((amount * cost).toFixed(2)),
    };
  });

  const totalsMap = new Map<LossCategory, { sqm: number; pcs: number; total: number; count: number }>();
  for (const r of rows) {
    const t = totalsMap.get(r.category) ?? { sqm: 0, pcs: 0, total: 0, count: 0 };
    if (r.unit === 'pcs') t.pcs += r.amount;
    else t.sqm += r.amount;
    t.total += r.total;
    t.count += 1;
    totalsMap.set(r.category, t);
  }
  const totals = Array.from(totalsMap.entries()).map(([cat, t]) => ({
    category: cat,
    label: LOSS_CATEGORY_LABEL[cat],
    count: t.count,
    sqm: Number(t.sqm.toFixed(2)),
    pcs: Number(t.pcs.toFixed(2)),
    total: Number(t.total.toFixed(2)),
  }));
  const grandTotal = Number(totals.reduce((s, t) => s + t.total, 0).toFixed(2));

  return { from, to, rows, totals, grandTotal };
}
