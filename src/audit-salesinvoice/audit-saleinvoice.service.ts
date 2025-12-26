import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

type AuditStatus = 'OK' | 'WARN' | 'FAIL';

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function r2(v: number) {
  return Number(v.toFixed(2));
}
function nearly(a: number, b: number, eps = 0.02) {
  return Math.abs(a - b) <= eps;
}

function isInt(x: any) {
  return Number.isInteger(Number(x));
}

@Injectable()
export class AuditService {
  constructor(private readonly ds: DataSource) {}

  async auditInvoices(opts: {
    from?: string;
    to?: string;
    page: number;
    limit: number;
    onlyFailed: boolean;
    deepStock: boolean;
  }) {
    const { from, to, page, limit, onlyFailed, deepStock } = opts;

    return this.ds.transaction(async (manager) => {
      const invRepo = manager.getRepository(Invoice);

      const qb = invRepo
        .createQueryBuilder('inv')
        .select([
          'inv.id',
          'inv.date',
          'inv.invoiceType',
          'inv.invoiceNumber',
          'inv.customerId',
          'inv.currencyId',
          'inv.currencyRate',
          'inv.totalWithoutVAT',
          'inv.totalVAT',
          'inv.grandTotal',
        ])
        .orderBy('inv.id', 'DESC');

      if (from) qb.andWhere('inv.date >= :from', { from });
      if (to) qb.andWhere('inv.date <= :to', { to });

      const totalInvoices = await qb.getCount();

      const invoices = await qb
        .skip((page - 1) * limit)
        .take(limit)
        .getMany();

      const invoiceIds = invoices.map((i) => i.id);
      const invoiceNumbers = invoices.map((i) => i.invoiceNumber);

      // 1) Fetch items for this page
      const itemRepo = manager.getRepository(InvoiceItem);
      const items = invoiceIds.length
        ? await itemRepo.find({ where: { invoiceId: In(invoiceIds) } as any })
        : [];

      const itemsByInvoice = new Map<number, InvoiceItem[]>();
      for (const it of items) {
        if (!itemsByInvoice.has(it.invoiceId)) itemsByInvoice.set(it.invoiceId, []);
        itemsByInvoice.get(it.invoiceId)!.push(it);
      }

      // ✅ 1.5) Fetch stockMode per itemVariantId (ItemVariant -> Thickness -> Item.stockMode)
      const variantIds = Array.from(
        new Set(
          items
            .map((x: any) => x.itemVariantId)
            .filter((x: any) => isInt(x))
            .map((x: any) => Number(x)),
        ),
      );

      const stockModeByVariantId = new Map<number, 'SQM' | 'QTY' | 'NONE' | null>();

      if (variantIds.length) {
        // using raw joins to avoid loading heavy relations
        const raw = await manager
          .getRepository(ItemVariant)
          .createQueryBuilder('v')
          .leftJoin('v.thickness', 't')
          .leftJoin('t.item', 'it')
          .select('v.id', 'variantId')
          .addSelect('it.stockMode', 'stockMode')
          .where('v.id IN (:...ids)', { ids: variantIds })
          .getRawMany();

        for (const r of raw) {
          const vid = Number(r.variantId);
          const sm = (r.stockMode ?? null) as any;
          stockModeByVariantId.set(vid, sm);
        }
      }

      // 2) Fetch JV details for this page (by docNbr = invoiceNumber)
      const jvDetailRepo = manager.getRepository(JournalVoucherDetail);
      const jvDetails = invoiceNumbers.length
        ? await jvDetailRepo.find({ where: { docNbr: In(invoiceNumbers) } as any })
        : [];

      const jvByDocNbr = new Map<string, JournalVoucherDetail[]>();
      for (const d of jvDetails as any[]) {
        const key = String(d.docNbr || '');
        if (!jvByDocNbr.has(key)) jvByDocNbr.set(key, []);
        jvByDocNbr.get(key)!.push(d);
      }

      // 3) Fetch inventory tx for this page: join via invoiceItemId
      const invTxRepo = manager.getRepository(InventoryTransaction);
      const itemIds = items
        .map((x: any) => x.id)
        .filter((x: any) => Number.isInteger(x));

      const txs = itemIds.length
        ? await invTxRepo.find({ where: { invoiceItemId: In(itemIds) } as any })
        : [];

      const txByItem = new Map<number, InventoryTransaction[]>();
      for (const t of txs as any[]) {
        const k = Number(t.invoiceItemId);
        if (!txByItem.has(k)) txByItem.set(k, []);
        txByItem.get(k)!.push(t);
      }

      // 4) Optional: quick batch sanity for involved batches (not per invoice historical)
      const batchRepo = manager.getRepository(ItemBatch);
      const batchIds = Array.from(
        new Set(
          items
            .map((it: any) => it.itemBatchId)
            .filter((x: any) => Number.isInteger(x)),
        ),
      );

      const batches =
        deepStock && batchIds.length
          ? await batchRepo.find({ where: { id: In(batchIds) } as any })
          : [];

      const batchMap = new Map<number, any>();
      for (const b of batches as any[]) batchMap.set(Number(b.id), b);

      const results = invoices.map((inv) => {
        const issues: Array<{
          code: string;
          level: 'WARN' | 'FAIL';
          message: string;
          meta?: any;
        }> = [];

        const invItems = itemsByInvoice.get(inv.id) || [];

        // A) totals = sum(items)
        const sumWithoutVat = r2(invItems.reduce((acc, it: any) => acc + n(it.totalAmount), 0));
        const sumVat = r2(invItems.reduce((acc, it: any) => acc + n(it.vat), 0));
        const sumGrand = r2(sumWithoutVat + sumVat);

        if (!invItems.length) {
          issues.push({ code: 'NO_ITEMS', level: 'FAIL', message: 'Invoice has no items' });
        }
        if (!nearly(n(inv.totalWithoutVAT), sumWithoutVat)) {
          issues.push({
            code: 'TOTAL_WITHOUT_VAT_MISMATCH',
            level: 'FAIL',
            message: 'Invoice.totalWithoutVAT != sum(items.totalAmount)',
            meta: { header: n(inv.totalWithoutVAT), calc: sumWithoutVat },
          });
        }
        if (!nearly(n(inv.totalVAT), sumVat)) {
          issues.push({
            code: 'TOTAL_VAT_MISMATCH',
            level: 'FAIL',
            message: 'Invoice.totalVAT != sum(items.vat)',
            meta: { header: n(inv.totalVAT), calc: sumVat },
          });
        }
        if (!nearly(n(inv.grandTotal), sumGrand)) {
          issues.push({
            code: 'GRAND_TOTAL_MISMATCH',
            level: 'FAIL',
            message: 'Invoice.grandTotal != sum(items.totalAmount)+sum(items.vat)',
            meta: { header: n(inv.grandTotal), calc: sumGrand },
          });
        }

        // B) JV exists + balanced + matches invoice
        const doc = String(inv.invoiceNumber || '');
        const jvs = jvByDocNbr.get(doc) || [];

        if (!jvs.length) {
          issues.push({
            code: 'MISSING_JV',
            level: 'FAIL',
            message: `No JV details found for docNbr=${doc}`,
          });
        } else {
          const sum = (k: string) => r2(jvs.reduce((acc: number, d: any) => acc + n(d[k]), 0));

          const dr = sum('dr');
          const cr = sum('cr');
          const drUSD = sum('drUSD');
          const crUSD = sum('crUSD');
          const drLL = sum('drLL');
          const crLL = sum('crLL');
          const drOFR = sum('drOFR');
          const crOFR = sum('crOFR');
          const drUSDOFR = sum('drUSDOFR');
          const crUSDOFR = sum('crUSDOFR');
          const drLLOFR = sum('drLLOFR');
          const crLLOFR = sum('crLLOFR');

          if (
            !nearly(dr, cr) ||
            !nearly(drUSD, crUSD) ||
            !nearly(drLL, crLL) ||
            !nearly(drOFR, crOFR) ||
            !nearly(drUSDOFR, crUSDOFR) ||
            !nearly(drLLOFR, crLLOFR)
          ) {
            issues.push({
              code: 'JV_NOT_BALANCED',
              level: 'FAIL',
              message: 'JV is not balanced (Dr != Cr)',
              meta: {
                dr,
                cr,
                drUSD,
                crUSD,
                drLL,
                crLL,
                drOFR,
                crOFR,
                drUSDOFR,
                crUSDOFR,
                drLLOFR,
                crLLOFR,
              },
            });
          }

          const grand = r2(n(inv.grandTotal));
          const ofrUsed = drOFR > 0 || drUSDOFR > 0 || drLLOFR > 0;

          if (ofrUsed) {
            const base = drUSDOFR > 0 ? drUSDOFR : drOFR;
            if (!nearly(base, grand)) {
              issues.push({
                code: 'JV_TOTAL_MISMATCH_OFR',
                level: 'FAIL',
                message: 'JV OFR total != invoice.grandTotal',
                meta: { invoiceGrand: grand, jvBase: base, drOFR, drUSDOFR },
              });
            }
          } else {
            // adjust if your currencyId mapping differs
            if (Number(inv.currencyId) === 2) {
              if (!nearly(drLL, grand)) {
                issues.push({
                  code: 'JV_TOTAL_MISMATCH_LL',
                  level: 'FAIL',
                  message: 'JV LL total != invoice.grandTotal',
                  meta: { invoiceGrand: grand, jvDrLL: drLL },
                });
              }
            } else {
              if (!nearly(drUSD, grand)) {
                issues.push({
                  code: 'JV_TOTAL_MISMATCH_USD',
                  level: 'FAIL',
                  message: 'JV USD total != invoice.grandTotal',
                  meta: { invoiceGrand: grand, jvDrUSD: drUSD },
                });
              }
            }
          }
        }

        // C) Inventory tx exists per item + sign check
        for (const it of invItems as any[]) {
          const variantId = Number(it.itemVariantId);
          const stockMode = stockModeByVariantId.get(variantId) ?? null;

          // ✅ FIX: stockMode NONE means NO inventory transaction is expected
          if (stockMode === 'NONE') {
            // skip inventory & batch checks for this item
            continue;
          }

          const list = txByItem.get(Number(it.id)) || [];
          if (!list.length) {
            issues.push({
              code: 'MISSING_INV_TX',
              level: 'FAIL',
              message: `Missing inventory transaction for invoiceItemId=${it.id}`,
              meta: {
                invoiceItemId: it.id,
                itemVariantId: it.itemVariantId,
                itemBatchId: it.itemBatchId,
                stockMode,
              },
            });
            continue;
          }

          const qty = n(it.quantity);
          const sqm = n(it.sqm);
          const t = list[0] as any;
          const type = String(inv.invoiceType || '');

          if (type === 'S' || type === 'RVR' || type === 'RTN') {
            if (!nearly(n(t.quantity), -qty) || !nearly(n(t.sqm), -sqm)) {
              issues.push({
                code: 'INV_TX_SIGN_MISMATCH',
                level: 'FAIL',
                message: `Inventory tx sign mismatch for type=${type}`,
                meta: {
                  invoiceItemId: it.id,
                  stockMode,
                  expected: { quantity: -qty, sqm: -sqm },
                  got: { quantity: n(t.quantity), sqm: n(t.sqm) },
                },
              });
            }
          } else if (type === 'G') {
            if (!nearly(n(t.quantity), 0) || !nearly(n(t.sqm), 0)) {
              issues.push({
                code: 'INV_TX_STD_NOT_ZERO_G',
                level: 'FAIL',
                message: 'G should not move STD quantity/sqm',
                meta: {
                  invoiceItemId: it.id,
                  stockMode,
                  got: { quantity: n(t.quantity), sqm: n(t.sqm) },
                },
              });
            }
            if (!nearly(n(t.quantityofr), -qty) || !nearly(n(t.sqmofr), -sqm)) {
              issues.push({
                code: 'INV_TX_OFR_MISMATCH_G',
                level: 'FAIL',
                message: 'G OFR movement mismatch',
                meta: {
                  invoiceItemId: it.id,
                  stockMode,
                  expected: { quantityofr: -qty, sqmofr: -sqm },
                  got: { quantityofr: n(t.quantityofr), sqmofr: n(t.sqmofr) },
                },
              });
            }
          }

          // D) Optional stock sanity
          if (deepStock && it.itemBatchId != null) {
            const b = batchMap.get(Number(it.itemBatchId));
            if (b) {
              const expectedBal = r2(n(b.start) + n(b.in) - n(b.out));
              const expectedBalO = r2(n(b.startOFR) + n(b.inOFR) - n(b.outOFR));

              if (!nearly(n(b.balance), expectedBal)) {
                issues.push({
                  code: 'BATCH_BALANCE_BAD',
                  level: 'FAIL',
                  message: `Batch balance formula mismatch (batchId=${b.id})`,
                  meta: { balance: n(b.balance), expected: expectedBal },
                });
              }
              if (!nearly(n(b.balanceOFR), expectedBalO)) {
                issues.push({
                  code: 'BATCH_BALANCE_OFR_BAD',
                  level: 'FAIL',
                  message: `Batch balanceOFR formula mismatch (batchId=${b.id})`,
                  meta: { balanceOFR: n(b.balanceOFR), expected: expectedBalO },
                });
              }

              if (n(b.balance) < -0.01) {
                issues.push({
                  code: 'NEGATIVE_BATCH_BALANCE',
                  level: 'WARN',
                  message: `Batch balance is negative (batchId=${b.id})`,
                  meta: { balance: n(b.balance) },
                });
              }
              if (n(b.balanceOFR) < -0.01) {
                issues.push({
                  code: 'NEGATIVE_BATCH_BALANCE_OFR',
                  level: 'WARN',
                  message: `Batch balanceOFR is negative (batchId=${b.id})`,
                  meta: { balanceOFR: n(b.balanceOFR) },
                });
              }
            }
          }
        }

        const status: AuditStatus =
          issues.some((x) => x.level === 'FAIL') ? 'FAIL' : issues.length ? 'WARN' : 'OK';

        return {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceType: inv.invoiceType,
          date: inv.date,
          status,
          issues,
          summary: {
            itemsCount: invItems.length,
            totals: { sumWithoutVat, sumVat, sumGrand },
          },
        };
      });

      const filtered = onlyFailed ? results.filter((r) => r.status !== 'OK') : results;

      const stats = filtered.reduce(
        (acc, r) => {
          acc[r.status] += 1;
          return acc;
        },
        { OK: 0, WARN: 0, FAIL: 0 } as any,
      );

      return {
        meta: {
          from: from || null,
          to: to || null,
          page,
          limit,
          totalInvoices,
          onlyFailed,
          deepStock,
        },
        stats,
        results: filtered,
      };
    });
  }
}
