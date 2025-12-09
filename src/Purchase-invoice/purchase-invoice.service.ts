import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Like, Raw } from 'typeorm';
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

type VariantMode = 'box' | 'sheet' | 'sqm' | 'unit';

type VariantMeta = {
  id: number;
  itemNameDescriptionId: number | null;
  thicknessMm: any; 
  length: any;
  width: any;
  origin: string | null;
  sheetsPerBox: number | null;
  mode: VariantMode | null; 
};

type SiblingBucket = {
  sheet: VariantMeta | null;
  sqm: VariantMeta | null;
  unit: VariantMeta | null;
  boxBySpb: Map<number, VariantMeta>;
};

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
  

  private async recomputeVariantCostsAfterPurchaseEdit(opts: {
  cutoffDate: Date;
  affectedVariantIds: number[];
}) {
  const { cutoffDate, affectedVariantIds } = opts;
  if (!affectedVariantIds?.length) return;

  const cut = new Date(cutoffDate);
  cut.setHours(0, 0, 0, 0);

  // include siblings (sheet/sqm/unit + matching box)
  const expandedVariantIds = await this.expandAffectedVariantIds(affectedVariantIds);

  // load metas so we can find siblings/families
  const metas = await this.loadVariantMetas(expandedVariantIds);
  const metaById = new Map<number, any>(metas.map(m => [Number(m.id), m]));
  const siblingsByFamily = await this.resolveSiblingVariantsForBaseVariants(metas);

  // pick the box sibling to read costs from (same logic as your sales recompute)
  const pickBoxSource = (bucket: any, targetMeta: any) => {
    if (!bucket?.boxBySpb || bucket.boxBySpb.size === 0) return null;

    const targetSpb = Number(targetMeta?.sheetsPerBox ?? 0);

    if (targetSpb > 1) {
      const exact = bucket.boxBySpb.get(targetSpb);
      if (exact?.id) return exact;
    }

    if (bucket.boxBySpb.size === 1) return Array.from(bucket.boxBySpb.values())[0] ?? null;

    let best: any = null;
    let bestSpb = -1;
    for (const [spb, v] of bucket.boxBySpb.entries()) {
      if (spb > bestSpb) {
        bestSpb = spb;
        best = v;
      }
    }
    return best;
  };

  // update each target variant (variant + siblings) using costs as-of cutoff day
  const dayKey = cut.toISOString().slice(0, 10);
  const asOfUTC = new Date(dayKey + 'T00:00:00.000Z');

  const costCache = new Map<number, any>();

  for (const targetId of expandedVariantIds) {
    const target = metaById.get(Number(targetId));
    if (!target) continue;

    const nonBoxKey = this.familyKey({
      itemNameDescriptionId: target.itemNameDescriptionId ?? null,
      thicknessMm: target.thicknessMm,
      length: target.length,
      width: target.width,
      origin: target.origin ?? null,
      sheetsPerBox: target.sheetsPerBox ?? null,
      mode: 'sheet',
    });

    const bucket = siblingsByFamily.get(nonBoxKey);

    // choose purchase source variant (box preferred)
    let picked = target;
    if (target.mode !== 'box') {
      const boxSource = pickBoxSource(bucket, target);
      if (boxSource?.id) picked = boxSource;
    }

    const pickedVariantId = Number(picked.id);

    let costs = costCache.get(pickedVariantId);
    if (!costs) {
      costs = await this.getPurchaseAvgCostsAsOf(pickedVariantId, asOfUTC);
      costCache.set(pickedVariantId, costs);
    }

    // write EXACT costs (no /spb)
    await this.variantRepo.update(Number(targetId), {
      averageCost: costs?.averageCost ?? null,
      averageCostVM: costs?.averageCostVM ?? null,
      // if your variant entity also has these columns, include them:
      // averageCostC: costs?.averageCostC ?? null,
      // averageCostCVM: costs?.averageCostCVM ?? null,
    } as any);
  }
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


if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'S') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous" lookups

  console.log('🧾 PO Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceDate: invDate.toISOString(),
    cutoffForPrevious: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
  });

  const itemsByDesc = new Map<number, any[]>();

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Collect description IDs
  const descIds = new Set<number>();

  /* ────────────────────────────────────────────────
     PER-PII LOOP: STANDARD (OFR) + VM (VM)
     ──────────────────────────────────────────────── */
  for (const item of savedInvoice.items) {
    // ───────── STANDARD COST TRACK ─────────
    const variantt = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId', 'averageCost', 'averageCostVM'],
    });
    if (!variantt) {
      console.error(`❌ Variant ${item.itemVariantId} not found`);
      continue;
    }

    const vid = variantt.id;
    const descId = variantt.itemNameDescriptionId;

    // collect this PII under its description
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[STANDARD] ► Processing PII ${item.id} (variantId=${vid}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log(`[STANDARD]   invoice date (PO):`, invDate);
    console.log('[STANDARD] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqm: Number(item.sqm),
      sqmOfr: Number((item as any).sqm ?? 0),
      finalOFR: Number((item as any).finalOFR),
      finalCost: Number((item as any).finalCost),
    });

    // 0) Determine PREVIOUS AVERAGE (STANDARD / OFR chain)
    const qbPrevPII = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCost AS avg_cost',
        'pii.averageCostVM AS avg_cost_vm',
        'inv.id AS inv_id',
        'inv.date AS inv_date',
      ]);

    try {
      // @ts-ignore
      console.log('[PREV PII] SQL:', qbPrevPII.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[PREV PII] Params:', qbPrevPII.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }

    const prevPIIRaw = await qbPrevPII.getRawOne<{
      pii_id?: number;
      avg_cost?: string | number | null;
      avg_cost_vm?: string | number | null;
      inv_id?: number;
      inv_date?: Date;
    }>();

    console.log('[PREV PII] raw result:', prevPIIRaw ?? null);

    // 1) Sum prior sqm-OFR (EXCLUDING current invoice items) — inclusive cutoff
    const qbPrev = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: invDate });

    if (hasCurrPiiIds) {
      qbPrev.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[STANDARD] prevQty SQL:', qbPrev.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[STANDARD] prevQty Params:', qbPrev.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }
// 1) Determine previous quantity logic based on whether a previous PII exists or not
let prevQty = 0;

if (prevPIIRaw) {
  // There IS a previous settled PO → use historical inventory tx before this invoice
  const { sum: rawPrev } = await qbPrev.getRawOne();
  prevQty = Number(rawPrev) || 0;
  console.log(`[STANDARD] Using historical qty (since previous PII exists): prevQty = ${prevQty}`);
} else {
  // NO previous invoice → use ONLY opening stock (if any)
const openingRecord = await this.invTransRepo.manager
  .getRepository(InventoryCount)
  .createQueryBuilder('ic')
  .select('ic.sqmOfr', 'sqmOfr')
  .where('ic.itemVariantId = :vid', { vid: item.itemVariantId })
  .limit(1)
  .getRawOne();

prevQty = Number(openingRecord?.sqmOfr ?? 0);
console.log(`[STANDARD] No prior PII → using opening stock only: prevQty = ${prevQty}`);

}

    // 2) Prev avg-OFR (STANDARD)
    let prevAvg: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost != null) {
      prevAvg = Number(prevPIIRaw.avg_cost);
      console.log('[STANDARD] prevAvg from previous PII.averageCost:', {
        prevAvg,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInvId: prevPIIRaw.inv_id ?? null,
        prevInvDate: prevPIIRaw.inv_date ?? null,
      });
    } else {
      console.log('[STANDARD] no previous PII; computing weighted openings from InventoryCount (OFR)…');
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: { id: item.itemVariantId } },
          select: ['sqmOfr', 'finalCostOfr'],
        });

      const totalOpenQty = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0),
        0,
      );
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvg = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

      console.log('[STANDARD] openings snapshot + resolved prevAvg (OFR):', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvg,
      });
    }

    // 3) This PO’s sqmOfr & unitPrice (finalOFR)
    const poQty = Number((item as any).sqm ?? 0);
    const poCost = Number((item as any).finalOFR ?? 0);
    console.log('[STANDARD] current PO contribution (OFR):', { poQty, poCost });

    // 4) New blended avg-OFR
    const totalQty = prevQty + poQty;
    const lhs = prevAvg * prevQty; // previous value bucket
    const rhs = poCost * poQty; // current row value bucket
    const newAvg = totalQty > 0 ? (lhs + rhs) / totalQty : poCost;
    console.log('[STANDARD] blend details (OFR):', {
      formula: 'newAvg = (prevAvg*prevQty + poCost*poQty) / (prevQty + poQty)',
      prevAvg,
      prevQty,
      poCost,
      poQty,
      lhs,
      rhs,
      totalQty,
      newAvg,
      guardWhenTotalQtyIsZero: totalQty === 0 ? '(used poCost)' : '(used blend)',
    });

    // 5) Persist STANDARD into PurchaseInvoiceItem & ItemVariant
    const piiUpdateRes = await this.itemRepo.update(item.id, {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,
    });
    console.log('✓ [STANDARD] PII update result (OFR):', {
      piiId: item.id,
      affected: piiUpdateRes?.affected ?? 'n/a',
      set: { previousQuantity: prevQty, previousAverageCost: prevAvg, averageCost: newAvg },
    });

    const varUpdateResStd = await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
    console.log('✓ [STANDARD] Variant update result (OFR):', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResStd?.affected ?? 'n/a',
      set: { averageCost: newAvg, lastCost: poCost },
    });

    // ───────── VM COST TRACK (VM chain) ─────────
    const qbPrevVm = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevVm.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[VM] prevQty SQL:', qbPrevVm.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[VM] prevQty Params:', qbPrevVm.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }
    const { sum: rawPrevVm } = await qbPrevVm.getRawOne();
    const prevQtyVM = Number(rawPrevVm) || 0;
    console.log('[VM] prevQtyVM result (VM chain):', { rawPrevVm, prevQtyVM });

    // Prev avg VM: from previous PII.averageCostVM; if none, 0
    let prevAvgVM: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost_vm != null) {
      prevAvgVM = Number(prevPIIRaw.avg_cost_vm);
      console.log('[VM] prevAvgVM from previous PII.averageCostVM:', {
        prevAvgVM,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInvId: prevPIIRaw.inv_id ?? null,
        prevInvDate: prevPIIRaw.inv_date ?? null,
      });
    } else {
      prevAvgVM = 0;
      console.log('[VM] no previous PII found → prevAvgVM = 0');
    }

    const poQtyVM = Number(item.sqm);
    const poCostVM = Number((item as any).finalCost);

    const totalQtyVM = prevQtyVM + poQtyVM;
    const lhsVM = prevAvgVM * prevQtyVM;
    const rhsVM = poCostVM * poQtyVM;
    const newAvgVM = totalQtyVM > 0 ? (lhsVM + rhsVM) / totalQtyVM : poCostVM;
    console.log('[VM] blend details (VM):', {
      formula: 'newAvgVM = (prevAvgVM*prevQtyVM + poCostVM*poQtyVM) / (prevQtyVM + poQtyVM)',
      prevAvgVM,
      prevQtyVM,
      poCostVM,
      poQtyVM,
      lhsVM,
      rhsVM,
      totalQtyVM,
      newAvgVM,
      guardWhenTotalQtyVMIsZero: totalQtyVM === 0 ? '(used poCostVM)' : '(used blend)',
    });

    const piiUpdateResVM = await this.itemRepo.update(item.id, {
      previousQuantityVM: prevQtyVM,
      previousAverageCostVM: prevAvgVM,
      averageCostVM: newAvgVM,
    });
    console.log('✓ [VM] PII update result (VM):', {
      piiId: item.id,
      affected: piiUpdateResVM?.affected ?? 'n/a',
      set: {
        previousQuantityVM: prevQtyVM,
        previousAverageCostVM: prevAvgVM,
        averageCostVM: newAvgVM,
      },
    });

    const varUpdateResVM = await this.variantRepo.update(item.itemVariantId, {
      averageCostVM: newAvgVM,
      lastCostVM: poCostVM,
    });
    console.log('✓ [VM] Variant update result (VM):', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResVM?.affected ?? 'n/a',
      set: { averageCostVM: newAvgVM, lastCostVM: poCostVM },
    });
  } // end per-PII loop (STANDARD/VM)

  /* ────────────────────────────────────────────────
     C-LEVEL (by description, current invoice) — OFR
     ──────────────────────────────────────────────── */
  console.log('\n📚 C-Level (by description) calculations start');
  for (const descId of descIds) {
    console.log(`\n[C] ► Description ${descId}`);

    // all variants under this description
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[C] variantIdsForDesc:', variantIdsForDesc);
    const dayStart = new Date(invDate);
dayStart.setHours(0, 0, 0, 0);


    // previous qty (OFR sum), up to & INCLUDING invDate; exclude current PO rows
    const qbPrevC = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(COALESCE(tx.sqmofr, 0))', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    try {
      // @ts-ignore
      console.log('[C] prevQtyC SQL:', qbPrevC.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[C] prevQtyC Params:', qbPrevC.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }
    const { sum: rawPrevC } = await qbPrevC.getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;
    console.log('[C] prevQtyC result (OFR):', { rawPrevC, prevQtyC });

    // previous avgC from last settled PII on/before invDate; else openings (OFR)
    let prevAvgC: number;
    const lastDescItem = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date <= :date', { date: invDate })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();

    if (lastDescItem && lastDescItem.averageCostC != null) {
      prevAvgC = Number(lastDescItem.averageCostC);
      console.log('[C] prevAvgC from last PII.averageCostC:', prevAvgC);
    } else {
      console.log('[C] no prior PII.averageCostC, compute from openings (OFR)…');
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqmOfr', 'finalCostOfr'],
        });

      const totalOpenQty = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0),
        0,
      );
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
      console.log('[C] openings snapshot (OFR):', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvgC,
      });
    }

    // group CURRENT PO rows that share this description — OFR chain
    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce(
      (s, it: any) => s + Number(it.sqm ?? 0),
      0,
    );
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it: any) =>
        s + Number(it.sqm ?? 0) * Number(it.finalCost ?? 0),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
    console.log('[C] current PO group snapshot (OFR):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x: any) => ({
        piiId: x.id,
        sqmOfr: Number(x.sqmOfr ?? 0),
        finalOFR: Number(x.finalOFR ?? 0),
      })),
      poQtyC,
      weightedCostSum,
      poCostC,
    });

    const totalQtyC = prevQtyC + poQtyC;
    const lhsC = prevAvgC * prevQtyC;
    const rhsC = poCostC * poQtyC;
    const newAvgC = totalQtyC > 0 ? (lhsC + rhsC) / totalQtyC : poCostC;
    console.log('[C] blend details (OFR):', {
      formula: 'newAvgC = (prevAvgC*prevQtyC + poCostC*poQtyC) / (prevQtyC + poQtyC)',
      prevAvgC,
      prevQtyC,
      poCostC,
      poQtyC,
      lhsC,
      rhsC,
      totalQtyC,
      newAvgC,
      guardWhenTotalQtyCIsZero: totalQtyC === 0 ? '(used poCostC)' : '(used blend)',
    });

    // apply SAME C-values to ALL PII rows in this description on THIS PO
    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
      });
      console.log('✓ [C] PII row updated with C-values (OFR):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: { previousQuantityC: prevQtyC, previousAverageCostC: prevAvgC, averageCostC: newAvgC },
      });
    }
  }

  /* ────────────────────────────────────────────────
     CVM-LEVEL (by description, current invoice) — VM
     ──────────────────────────────────────────────── */
  console.log('\n📚 CVM-Level (by description) calculations start');
  for (const descId of descIds) {
    console.log(`\n[CVM] ► Description ${descId}`);

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[CVM] variantIdsForDesc:', variantIdsForDesc);

    const qbPrevCVM = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );

    try {
      // @ts-ignore
      console.log('[CVM] prevQtyCVM SQL:', qbPrevCVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[CVM] prevQtyCVM Params:', qbPrevCVM.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }

    const { sum: rawPrevCVM } = await qbPrevCVM.getRawOne();
    const prevQtyCVM = Number(rawPrevCVM) || 0;
    console.log('[CVM] prevQtyCVM result (VM):', { rawPrevCVM, prevQtyCVM });

    let prevAvgCVM: number;
    const lastDescItemCVM = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostCVM'])
      .getOne();

    if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
      prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
      console.log('[CVM] prevAvgCVM from last PII.averageCostCVM:', prevAvgCVM);
    } else {
      console.log('[CVM] no prior PII.averageCostCVM, compute from openings (VM)…');
      const openingsVM = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCost'],
        });

      const totalOpenQtyVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm ?? 0),
        0,
      );
      const weightedSumVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
        0,
      );
      prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
      console.log('[CVM] openings snapshot (VM):', {
        openingsCount: openingsVM.length,
        totalOpenQtyVM,
        weightedSumVM,
        prevAvgCVM,
      });
    }

    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyCVM = poItemsSameDesc.reduce(
      (s, it) => s + Number(it.sqm),
      0,
    );
    const weightedCostSumVM = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
      0,
    );
    const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

    console.log('[CVM] current PO group snapshot (VM):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x) => ({
        piiId: x.id,
        sqm: Number(x.sqm),
        finalCost: Number((x as any).finalCost),
      })),
      poQtyCVM,
      weightedCostSumVM,
      poCostCVM,
    });

    const totalQtyCVM = prevQtyCVM + poQtyCVM;
    const lhsCVM = prevAvgCVM * prevQtyCVM;
    const rhsCVM = poCostCVM * poQtyCVM;
    const newAvgCVM = totalQtyCVM > 0 ? (lhsCVM + rhsCVM) / totalQtyCVM : poCostCVM;
    console.log('[CVM] blend details (VM):', {
      formula: 'newAvgCVM = (prevAvgCVM*prevQtyCVM + poCostCVM*poQtyCVM) / (prevQtyCVM + poQtyCVM)',
      prevAvgCVM,
      prevQtyCVM,
      poCostCVM,
      poQtyCVM,
      lhsCVM,
      rhsCVM,
      totalQtyCVM,
      newAvgCVM,
      guardWhenTotalQtyCVMIsZero: totalQtyCVM === 0 ? '(used poCostCVM)' : '(used blend)',
    });

    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      });
      console.log('✓ [CVM] PII row updated with CVM-values (VM):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: {
          previousQuantityCVM: prevQtyCVM,
          previousAverageCostCVM: prevAvgCVM,
          averageCostCVM: newAvgCVM,
        },
      });
    }
  }

 /* ────────────────────────────────────────────────
     FINAL WRITE → UPDATE ItemNameDescription
     (NO recalculation — use already computed values)
   ──────────────────────────────────────────────── */

console.log('\n🗂 Writing final ItemNameDescription costs…');

for (const descId of descIds) {
  const poRows = itemsByDesc.get(descId) ?? [];

  if (!poRows.length) {
    console.warn(`⚠️ No PO rows found for descId: ${descId}, skipping…`);
    continue;
  }

  // Take any row of the same description — they all share SAME C & CVM values
  const ref = poRows[0];

// Reload one item from DB to get fresh updated values
const fresh = await this.itemRepo.findOne({ where: { id: ref.id } });

const finalWrite = {
  averageCostC: Number(fresh?.averageCostC ?? 0),
  averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
  lastCostC: Number((ref as any).finalOFR ?? 0),
  lastCostCVM: Number((ref as any).finalCost ?? 0),
};

  console.log(`📝 Updating Description ${descId} with:`, finalWrite);

  await this.descRepo.update(descId, finalWrite);

  console.log(`✓ Updated ItemNameDescription ${descId}`);
}

console.log('🧾 ItemNameDescription update (final) completed.');


  /* ────────────────────────────────────────────────
     FORWARD RECOMPUTE FOR LATER POs
     ──────────────────────────────────────────────── */
  const affectedVariantIds = Array.from(
    new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)),
  );
  const affectedDescIds = Array.from(descIds);

  if (affectedVariantIds.length || affectedDescIds.length) {
    console.log('🔁 Checking for later POs to recompute…', {
      affectedVariantIds,
      affectedDescIds,
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type = :typ', { typ: 'S' })
      .andWhere('inv.date > :cut', { cut: invDate })
      .andWhere(`(iv.id IN (:...varIds) OR iv.itemNameDescriptionId IN (:...descIds))`, {
        varIds: affectedVariantIds.length ? affectedVariantIds : [-1],
        descIds: affectedDescIds.length ? affectedDescIds : [-1],
      })
      .select('inv.id', 'id')
      .addSelect('inv.date', 'date')
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; date: Date }>();

    const laterIds = laterRaw.map((r) => r.id);
    console.log('🔁 Later PO IDs to recompute:', laterIds);

    const recomputeInvoice = async (targetId: number) => {
      const targetInv = await this.invoiceRepo.findOne({
        where: { id: targetId },
        relations: ['items', 'items.itemVariant'],
      });
      if (!targetInv) {
        console.warn('⚠️ Target invoice not found during forward recompute:', { targetId });
        return;
      }

      const cutoffDate = new Date(targetInv.date);
      const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
      const tHasCurrIds = tCurrPiiIds.length > 0;

      console.log(
        `\n🔁 Recomputing invoice ${targetInv.id} dated ${cutoffDate.toISOString().slice(0, 10)}`,
        { itemCount: targetInv.items?.length ?? 0, tHasCurrIds, tCurrPiiIds },
      );

      const tItemsByDesc = new Map<number, any[]>();
      const tDescIds = new Set<number>();

      // ───────── RECOMP: per-PII STANDARD/VM ─────────
      for (const item of targetInv.items) {
        const iv =
          item.itemVariant ??
          (await this.variantRepo.findOne({
            where: { id: item.itemVariantId },
          }));
        if (!iv) {
          console.warn('⚠️ Variant missing during recompute for PII:', item.id);
          continue;
        }
        const descId = iv.itemNameDescriptionId;

        if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
        tItemsByDesc.get(descId)!.push(item);
        tDescIds.add(descId);

        // STANDARD (OFR chain)
        const qbRPrev = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice < :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP STD] prev SQL:', qbRPrev.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP STD] prev Params:', qbRPrev.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */
        }
        const { sum: rawPrev } = await qbRPrev.getRawOne();
        const prevQty = Number(rawPrev) || 0;

        let prevAvg = iv.averageCost ?? 0; // baseline from current variant

        const poQty = Number((item as any).sqm ?? 0);
        const poCost = Number((item as any).finalOFR ?? 0);
        const totalQty = prevQty + poQty;
        const newAvg =
          totalQty > 0 ? (prevAvg * prevQty + poCost * poQty) / totalQty : poCost;
        console.log('[RECOMP STD] details (OFR):', {
          piiId: item.id,
          itemVariantId: item.itemVariantId,
          prevQty,
          prevAvg,
          poQty,
          poCost,
          totalQty,
          newAvg,
        });

        await this.itemRepo.update(item.id, {
          previousQuantity: prevQty,
          previousAverageCost: prevAvg,
          averageCost: newAvg,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCost: newAvg,
          lastCost: poCost,
        });

        // VM
        const qbRPrevVm = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP VM] prev SQL:', qbRPrevVm.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP VM] prev Params:', qbRPrevVm.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */
        }
        const { sum: rawPrevVm } = await qbRPrevVm.getRawOne();
        const prevQtyVM = Number(rawPrevVm) || 0;

        let prevAvgVM = iv.averageCostVM ?? 0;
        const poQtyVM = Number(item.sqm);
        const poCostVM = Number((item as any).finalCost);
        const totalQtyVM = prevQtyVM + poQtyVM;
        const newAvgVM =
          totalQtyVM > 0
            ? (prevAvgVM * prevQtyVM + poCostVM * poQtyVM) / totalQtyVM
            : poCostVM;
        console.log('[RECOMP VM] details (VM):', {
          piiId: item.id,
          itemVariantId: item.itemVariantId,
          prevQtyVM,
          prevAvgVM,
          poQtyVM,
          poCostVM,
          totalQtyVM,
          newAvgVM,
        });

        await this.itemRepo.update(item.id, {
          previousQuantityVM: prevQtyVM,
          previousAverageCostVM: prevAvgVM,
          averageCostVM: newAvgVM,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCostVM: newAvgVM,
          lastCostVM: poCostVM,
        });
      } // end per-PII in target

      // ───────── RECOMP C-LEVEL (OFR) ─────────
      console.log('\n[RECOMP C] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const qbRPrevC = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(COALESCE(tx.sqmofr, 0))', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP C] prevQtyC SQL:', qbRPrevC.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP C] prevQtyC Params:', qbRPrevC.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */
        }
        const { sum: rawPrevC } = await qbRPrevC.getRawOne();
        const prevQtyC = Number(rawPrevC) || 0;

        let prevAvgC: number;
        const lastDescItem = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
          .andWhere('inv.date <= :date', { date: cutoffDate })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostC'])
          .getOne();

        if (lastDescItem && lastDescItem.averageCostC != null) {
          prevAvgC = Number(lastDescItem.averageCostC);
        } else {
          const openings = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqmOfr', 'finalCostOfr'],
            });
          const totalOpenQty = openings.reduce(
            (s, o) => s + Number(o.sqmOfr ?? 0),
            0,
          );
          const weightedSum = openings.reduce(
            (s, o) =>
              s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
            0,
          );
          prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyC = poItemsSameDesc.reduce(
          (s, it: any) => s + Number(it.sqm ?? 0),
          0,
        );
        const weightedCostSum = poItemsSameDesc.reduce(
          (s, it: any) =>
            s + Number(it.sqm ?? 0) * Number(it.finalOFR ?? 0),
          0,
        );
        const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
        const totalQtyC = prevQtyC + poQtyC;
        const newAvgC =
          totalQtyC > 0
            ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC
            : poCostC;
        console.log('[RECOMP C] details (OFR):', {
          descId,
          prevQtyC,
          prevAvgC,
          poQtyC,
          weightedCostSum,
          poCostC,
          totalQtyC,
          newAvgC,
        });

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityC: prevQtyC,
            previousAverageCostC: prevAvgC,
            averageCostC: newAvgC,
          });
        }
      }

      // ───────── RECOMP CVM-LEVEL (VM) ─────────
      console.log('\n[RECOMP CVM] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const qbRPrevCVM = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );

        try {
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM SQL:', qbRPrevCVM.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM Params:', qbRPrevCVM.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */ }

        const { sum: rawPrevCVM } = await qbRPrevCVM.getRawOne();
        const prevQtyCVM = Number(rawPrevCVM) || 0;

        let prevAvgCVM = 0;
        const lastDescItemCVM = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
          .andWhere('inv.date <= :date', { date: cutoffDate })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostCVM'])
          .getOne();

        if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
          prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
        } else {
          const openingsVM = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqm', 'finalCost'],
            });

          const totalOpenQtyVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm ?? 0),
            0,
          );
          const weightedSumVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
            0,
          );
          prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyCVM = poItemsSameDesc.reduce(
          (s, it) => s + Number(it.sqm),
          0,
        );
        const weightedCostSumVM = poItemsSameDesc.reduce(
          (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
          0,
        );
        const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

        const totalQtyCVM = prevQtyCVM + poQtyCVM;
        const newAvgCVM =
          totalQtyCVM > 0
            ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalQtyCVM
            : poCostCVM;

        console.log('[RECOMP CVM] details (VM):', {
          descId,
          prevQtyCVM,
          prevAvgCVM,
          poQtyCVM,
          weightedCostSumVM,
          poCostCVM,
          totalQtyCVM,
          newAvgCVM,
        });

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityCVM: prevQtyCVM,
            previousAverageCostCVM: prevAvgCVM,
            averageCostCVM: newAvgCVM,
          });
        }
      }

    // ───────── RECOMP ItemNameDescription UPDATE (NO recalculation) ─────────
console.log('\n[RECOMP DESC] Updating ItemNameDescription based on final recomputed rows…');

for (const descId of tDescIds) {
  const rows = tItemsByDesc.get(descId) ?? [];
  if (!rows.length) {
    console.warn(`⚠️ No matching rows for descId ${descId} during recompute.`);
    continue;
  }

  // Any row of the same description — they all share same cost after recompute
  const ref = rows[0];

  // 🔹 IMPORTANT: reload fresh row from DB to get the recomputed averages
  const fresh = await this.itemRepo.findOne({
    where: { id: ref.id },
  });

  const updateValues = {
    averageCostC: Number(fresh?.averageCostC ?? 0),
    averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
    lastCostC: Number((ref as any).finalOFR ?? 0),
    lastCostCVM: Number((ref as any).finalCost ?? 0),
  };

  console.log(`[RECOMP DESC] Writing to Description ${descId}:`, updateValues);

  await this.descRepo.update(descId, updateValues);

  console.log(`✓ Updated ItemNameDescription ${descId} (recompute apply)`);
}


    };

    for (const id of laterIds) {
      await recomputeInvoice(id);
    }
    console.log('🔁 Forward recompute complete.');
  }

  console.log('🧾 PO Cost Calc — End', { invoiceId: savedInvoice.id });
}

// 🔎 END: Cost-calculation & logging block

// 🔎 BEGIN: Cost-calculation & logging block (prevAvg now pulled from last prior PO; VM fallback=0; STANDARD fallback=weighted openings)
// 🔎 BEGIN: G-invoice cost-calculation & logging block (type-based history: G/S/SR; OFR-only; VM fields = NULL)
if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'G') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous" lookups

  console.log('🧾 [G] PO Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceType: savedInvoice.type,
    invoiceDateISO: invDate.toISOString(),
    cutoffForPreviousISO: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
    priorTypes: ['G', 'S', 'SR'],
  });

  const itemsByDesc = new Map<number, any[]>();

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 [G] Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Collect description IDs
  const descIds = new Set<number>();

  for (const item of savedInvoice.items) {
    // ───────── STANDARD (OFR) COST TRACK — G invoices use OFR only ─────────
    const variantt = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId'],
    });
    if (!variantt) {
      console.error(`❌ [G] Variant ${item.itemVariantId} not found`);
      continue;
    }

    const vid = variantt.id;
    const descId = variantt.itemNameDescriptionId;

    // collect this PII under its description
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[STANDARD:G] ► Processing PII ${item.id} (variantId=${vid}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log('[STANDARD:G] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqm: Number(item.sqm),
      finalOFR: Number((item as any).finalOFR),
      finalCost: Number((item as any).finalCost),
    });

    // 0) Determine PREVIOUS AVERAGE (NEW: type-based search G/S/SR; exclude same day)
    const priorTypes = ['G', 'S', 'SR'] as const;
    const qbPrevPII = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: priorTypes })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCost AS avg_cost',
        'pii.averageCostC AS avg_cost_c',
        'inv.id AS inv_id',
        'inv.date AS inv_date',
        'inv.type AS inv_type',
      ]);

    try {
      // @ts-ignore
      console.log('[PREV PII:G] SQL:', qbPrevPII.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[PREV PII:G] Params:', qbPrevPII.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const prevPIIRaw = await qbPrevPII.getRawOne<{
      pii_id?: number;
      avg_cost?: string | number | null;
      avg_cost_c?: string | number | null;
      inv_id?: number;
      inv_date?: Date;
      inv_type?: string;
    }>();
    console.log('[PREV PII:G] raw result:', prevPIIRaw ?? null);

    // 1) Sum prior quantity — OFR ONLY, inclusive cutoff (<= invDate), exclude current PII
    const qbPrevQty = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevQty.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[STANDARD:G] prevQty (OFR) SQL:', qbPrevQty.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[STANDARD:G] prevQty (OFR) Params:', qbPrevQty.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevOfr } = await qbPrevQty.getRawOne();
    const prevQty = Number(rawPrevOfr) || 0;
    console.log('[STANDARD:G] prevQty (OFR) result:', { rawPrevOfr, prevQty });

    // 2) Prev avg-OFR — from previous PII.averageCost across types G/S/SR; else openings (OFR)
    let prevAvg: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost != null) {
      prevAvg = Number(prevPIIRaw.avg_cost);
      console.log('[STANDARD:G] prevAvg from previous PII.averageCost:', {
        prevAvg,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInv: {
          id: prevPIIRaw.inv_id ?? null,
          type: prevPIIRaw.inv_type ?? null,
          date: prevPIIRaw.inv_date ?? null,
        },
      });
    } else {
      console.log('[STANDARD:G] no previous PII; computing weighted openings from InventoryCount (OFR)…');
      const openings = await this.invTransRepo.manager.getRepository(InventoryCount).find({
        where: { itemVariant: { id: item.itemVariantId } },
        select: ['sqmOfr', 'finalCostOfr'],
      });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr) * Number(o.finalCostOfr),
        0,
      );
      prevAvg = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

      console.log('[STANDARD:G] openings snapshot + resolved prevAvg:', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvg,
      });
    }

    // 3) Current PO — OFR inputs only
    const poQty = Number(item.sqm);
    const poCost = Number((item as any).finalOFR);
    console.log('[STANDARD:G] current PO contribution (OFR):', { poQty, poCost });

    // 4) Blend (OFR)
    const totalQty = prevQty + poQty;
    const lhs = prevAvg * prevQty; // value of stock before
    const rhs = poCost * poQty;    // value of current receipt
    const newAvg = totalQty > 0 ? (lhs + rhs) / totalQty : poCost;
    console.log('[STANDARD:G] blend details (OFR):', {
      formula: 'newAvg = (prevAvg*prevQty + poCost*poQty) / (prevQty + poQty)',
      prevAvg,
      prevQty,
      poCost,
      poQty,
      lhs,
      rhs,
      totalQty,
      newAvg,
      guardWhenTotalQtyIsZero: totalQty === 0 ? '(used poCost)' : '(used blend)',
    });

    // 5) Persist — STANDARD fields + explicitly NULL out VM/CVM "previous" fields
    const piiUpdatePayload: any = {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,

      // VM track is NOT used for G → set NULLs
      previousQuantityVM: null,
      previousAverageCostVM: null,

      // If your schema has CVM "previous" fields, we also null them out:
      previousQuantityCVM: null,
      previousAverageCostCVM: null,
    };

    const piiUpdateRes = await this.itemRepo.update(item.id, piiUpdatePayload);
    console.log('✓ [STANDARD:G] PII update result:', {
      piiId: item.id,
      affected: piiUpdateRes?.affected ?? 'n/a',
      set: piiUpdatePayload,
    });

    // Update variant — OFR stats only; do NOT touch VM stats
    const varUpdateResStd = await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
    console.log('✓ [STANDARD:G] Variant update result (OFR only):', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResStd?.affected ?? 'n/a',
      set: { averageCost: newAvg, lastCost: poCost },
      note: 'VM stats untouched for G invoices',
    });

    // (No VM track for G)
    console.log('ⓘ [G] VM calculation skipped. VM-related previous fields saved as NULL.');
  } // end per-PII loop

  // ───────── C-LEVEL (description) FOR CURRENT G INVOICE — ONCE PER DESCRIPTION ─────────
  console.log('\n📚 [G] C-Level (by description) calculations start');
  for (const descId of descIds) {
    console.log(`\n[C:G] ► Description ${descId}`);

    // all variants under this description
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[C:G] variantIdsForDesc:', variantIdsForDesc);

    // previous qty (OFR ONLY), up to & INCLUDING invDate; exclude current PO rows
    const qbPrevC = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    try {
      // @ts-ignore
      console.log('[C:G] prevQtyC (OFR) SQL:', qbPrevC.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[C:G] prevQtyC (OFR) Params:', qbPrevC.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }
    const { sum: rawPrevC } = await qbPrevC.getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;
    console.log('[C:G] prevQtyC (OFR) result:', { rawPrevC, prevQtyC });



    console.log(`\n🔍 [C-DEBUG] Resolving previous average cost C for descId=${descId}`);

const lastDescItemDebugQB = this.itemRepo
  .createQueryBuilder('pii')
  .innerJoin('pii.invoice', 'inv')
  .innerJoin('pii.itemVariant', 'iv')
  .where('inv.status = :status', { status: 'Recieved' })
  .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
  .andWhere('inv.date < :date', { date: dayStart })
  .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
  .andWhere('iv.itemNameDescriptionId = :descId', { descId })
  .orderBy('inv.date', 'DESC')
  .addOrderBy('pii.id', 'DESC')
  .select([
    'pii.id AS pii_id',
    'pii.averageCostC AS avg_cost_c',
    'pii.averageCost AS avg_cost_ofr',
    'pii.finalCost AS lastFinalCost',
    'inv.id AS inv_id',
    'inv.type AS inv_type',
    'inv.date AS inv_date'
  ]);

try {
  console.log('🧠 [C-DEBUG] SQL used to search for historical C:', lastDescItemDebugQB.getSql());
  console.log('🧠 [C-DEBUG] Params:', lastDescItemDebugQB.getParameters());
} catch {}

const historyRows = await lastDescItemDebugQB.getRawMany();
console.log(`📄 [C-DEBUG] Found ${historyRows.length} candidate rows:`);

historyRows.forEach((row, i) =>
  console.log(`   ➤ Row #${i+1}:`, {
    piiId: row.pii_id,
    invId: row.inv_id,
    invoiceType: row.inv_type,
    invoiceDate: row.inv_date,
    averageCostC: row.avg_cost_c,
    fallback_OFR: row.avg_cost_ofr,
    fallback_lastCost: row.lastFinalCost
  })
);

    // 🔽 Decision
let prevAvgC: number;

if (historyRows.length > 0) {
  const firstValid = historyRows.find(r => r.avg_cost_c !== null);
  if (firstValid) {
    prevAvgC = Number(firstValid.avg_cost_c);
    console.log(`🎯 [C-DEBUG] PREVIOUS AVERAGE FOUND → using averageCostC=${prevAvgC} from PII=${firstValid.pii_id}`);
  } else {
    console.log(`⚠️ [C-DEBUG] Historical rows exist, but NONE have averageCostC recorded.`);
    console.log(`➡️ Fallback: Will compute from openings or finalOFR.`);

    prevAvgC = null as any; // force fallback
  }
} else {
  console.log(`❌ [C-DEBUG] No historical invoices match C-level rules.`);
  prevAvgC = null as any; // trigger fallback
}

// ─────────────────────────────
// 💾 OPENING STOCK FALLBACK
// ─────────────────────────────
if (prevAvgC === null) {
  console.log(`🔁 [C-DEBUG] Computing fallback from InventoryCount (openings)…`);
  const openings = await this.invTransRepo.manager
    .getRepository(InventoryCount)
    .find({
      where: { itemVariant: In(variantIdsForDesc) },
      select: ['sqmOfr', 'finalCostOfr'],
    });

  console.log(`📦 [C-DEBUG] Opening rows (${openings.length}):`);

  openings.forEach((op, i) =>
    console.log(`   ➤ Opening #${i+1}: sqmOfr=${op.sqmOfr}, cost=${op.finalCostOfr}`)
  );

  const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
  const weightedSum = openings.reduce(
    (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
    0,
  );

  prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

  console.log(`📊 [C-DEBUG] Result of fallback calculation:`);
  console.log({
    totalOpenQty,
    weightedSum,
    computedAvg: prevAvgC
  });

  if (prevAvgC === 0) {
    console.log(`⚠️ [C-DEBUG] Fallback avg=0 → meaning: no openings + no history → this invoice is first cost reference!`);
  }
}

console.log(`✅ [C-DEBUG] FINAL selected prevAvgC=${prevAvgC}`);

    // group CURRENT PO rows that share this description (OFR)
    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalOFR) * Number(it.sqm),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
    console.log('[C:G] current PO group snapshot (OFR):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x) => ({
        piiId: x.id,
        sqm: Number(x.sqm),
        finalOFR: Number((x as any).finalOFR),
      })),
      poQtyC,
      weightedCostSum,
      poCostC,
    });

    const totalQtyC = prevQtyC + poQtyC;
    const lhsC = prevAvgC * prevQtyC;
    const rhsC = poCostC * poQtyC;
    const newAvgC = totalQtyC > 0 ? (lhsC + rhsC) / totalQtyC : poCostC;
    console.log('[C:G] blend details (OFR):', {
      formula: 'newAvgC = (prevAvgC*prevQtyC + poCostC*poQtyC) / (prevQtyC + poQtyC)',
      prevAvgC,
      prevQtyC,
      poCostC,
      poQtyC,
      lhsC,
      rhsC,
      totalQtyC,
      newAvgC,
      guardWhenTotalQtyCIsZero: totalQtyC === 0 ? '(used poCostC)' : '(used blend)',
    });

    // apply SAME C-values to ALL PII rows in this description on THIS PO
    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,

        // If your schema carries CVM "previous" fields and you wish them NULL on G, you can also set:
        previousQuantityCVM: null,
        previousAverageCostCVM: null,
      });
      console.log('✓ [C:G] PII row updated with C-values:', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: { previousQuantityC: prevQtyC, previousAverageCostC: prevAvgC, averageCostC: newAvgC },
      });
    }
  }
  // ───────── UPDATE ItemNameDescription TABLE (OFR-only) ─────────
  console.log('\n🗂 [G] Updating ItemNameDescription table…');
  for (const descId of descIds) {
    console.log(`\n— [G] Updating ItemNameDescription ${descId} —`);

    // 🔹 We ALREADY computed C-level averages above per description
    //    and wrote them into the PII rows.
    //    Here, we just mirror those values into ItemNameDescription.

    // All current PO rows for this description on THIS invoice
    const poItemsForDesc = itemsByDesc.get(descId) ?? [];
    if (!poItemsForDesc.length) {
      console.log('[C->Desc:G] No current PII rows for this description; skipping.');
      continue;
    }

    // Any row of this description on this invoice has the same averageCostC
    // (you set it in the previous C-level loop). We'll read from the first.
    const samplePii = poItemsForDesc[0] as any;

    const averageCostC = Number(samplePii.averageCostC ?? 0);

    // lastCostC = finalOFR of the last row of this description in this PO
    const lastRow = poItemsForDesc[poItemsForDesc.length - 1] as any;
    const lastCostC = Number(lastRow?.finalOFR ?? 0);

    console.log('[C->Desc:G] Mirroring C-values from PII into ItemNameDescription:', {
      descId,
      samplePiiId: samplePii.id,
      averageCostC,
      lastCostC,
      piiIds: poItemsForDesc.map((x: any) => x.id),
    });

    const descUpdateRes = await this.descRepo.update(descId, {
      averageCostC,
      lastCostC,
    });

    console.log('✓ [C->Desc:G] ItemNameDescription update (NO recalculation):', {
      descId,
      affected: descUpdateRes?.affected ?? 'n/a',
      set: { averageCostC, lastCostC },
    });
  }


  // ─────────────────────────────
  // ⚙️ Forward recompute for back-dated inserts
  //   - If a later invoice is type G, use SAME prior rule (types IN G/S/SR, cutoff = that invoice day start)
  //   - Keep VM NULL for G
  // ─────────────────────────────
  const affectedVariantIds = Array.from(
    new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)),
  );
  const affectedDescIds = Array.from(descIds);

  if (affectedVariantIds.length || affectedDescIds.length) {
    console.log('🔁 [G] Checking for later POs to recompute…', {
      affectedVariantIds,
      affectedDescIds,
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] }) // recompute later invoices of these types (safe superset)
      .andWhere('inv.date > :cut', { cut: dayStart })
      .andWhere(`(iv.id IN (:...varIds) OR iv.itemNameDescriptionId IN (:...descIds))`, {
        varIds: affectedVariantIds.length ? affectedVariantIds : [-1],
        descIds: affectedDescIds.length ? affectedDescIds : [-1],
      })
      .select('inv.id', 'id')
      .addSelect('inv.type', 'type')
      .addSelect('inv.date', 'date')
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; type: 'G' | 'S' | 'SR'; date: Date }>();
const laterIds = laterRaw.map((r) => r.id);
console.log('🔁 [G] Later PO IDs to recompute:', laterIds, { meta: laterRaw });

/**
 * Recompute for a later G invoice (OFR-only; VM previous fields kept NULL)
 * — This is your existing G recompute body, kept intact.
 */
const recomputeInvoiceG = async (targetId: number) => {
  const targetInv = await this.invoiceRepo.findOne({
    where: { id: targetId },
    relations: ['items', 'items.itemVariant'],
  });
  if (!targetInv) {
    console.warn('⚠️ Target invoice not found during forward recompute (G):', { targetId });
    return;
  }

  const cutoffDate = new Date(targetInv.date);
  const cutoffDayStart = new Date(cutoffDate);
  cutoffDayStart.setHours(0, 0, 0, 0);

  const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
  console.log(
    `\n🔁 [RECOMP:G] Invoice ${targetInv.id} dated ${cutoffDate.toISOString().slice(0, 10)} (OFR-only)`,
    { itemCount: targetInv.items?.length ?? 0, tCurrPiiIds },
  );

  const tItemsByDesc = new Map<number, any[]>();
  const tDescIds = new Set<number>();

  for (const item of targetInv.items) {
    const iv =
      item.itemVariant ??
      (await this.variantRepo.findOne({
        where: { id: item.itemVariantId },
      }));
    if (!iv) {
      console.warn('⚠️ [RECOMP:G] Variant missing for PII:', item.id);
      continue;
    }
    const descId = iv.itemNameDescriptionId;

    if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
    tItemsByDesc.get(descId)!.push(item);
    tDescIds.add(descId);

    // prev qty (OFR)
    const { sum: rawPrev } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
        { currIds: tCurrPiiIds },
      )
      .getRawOne();
    const prevQty = Number(rawPrev) || 0;

    // prev avg from last prior PII among (G,S,SR) before that day’s start
    let prevAvg = 0;
    const prevPII = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :cutoff', { cutoff: cutoffDayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCost AS avg_cost', 'pii.id AS pii_id', 'inv.id AS inv_id', 'inv.type AS inv_type', 'inv.date AS inv_date'])
      .getRawOne<{ avg_cost?: number | string | null; pii_id?: number; inv_id?: number; inv_type?: string; inv_date?: Date }>();

    if (prevPII?.avg_cost != null) {
      prevAvg = Number(prevPII.avg_cost);
      console.log('[RECOMP:G] prevAvg from prior PII.averageCost (G/S/SR):', {
        itemId: item.id,
        variantId: item.itemVariantId,
        prevAvg,
        prevPiiMeta: { piiId: prevPII.pii_id, invId: prevPII.inv_id, invType: prevPII.inv_type, invDate: prevPII.inv_date },
      });
    } else {
      // openings fallback
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({ where: { itemVariant: { id: iv.id } }, select: ['sqm', 'finalCostOfr'] });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce((s, o) => s + Number(o.sqm) * Number(o.finalCostOfr), 0);
      prevAvg = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
      console.log('[RECOMP:G] openings fallback → prevAvg:', { itemId: item.id, variantId: item.itemVariantId, totalOpenQty, weightedSum, prevAvg });
    }

    // blend (OFR)
    const poQty = Number(item.sqm);
    const poCost = Number((item as any).finalOFR);
    const totalQty = prevQty + poQty;
    const newAvg = totalQty > 0 ? (prevAvg * prevQty + poCost * poQty) / totalQty : poCost;

    await this.itemRepo.update(item.id, {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,
      // ensure VM previous remain NULL for G invoices
      previousQuantityVM: null,
      previousAverageCostVM: null,
      previousQuantityCVM: null,
      previousAverageCostCVM: null,
    });
    await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
  }

  // C-level (OFR-only)
  console.log('\n[RECOMP C:G] start for invoice:', targetInv.id);
  for (const descId of tDescIds) {
    const variantIdsForDesc = (
      await this.variantRepo.find({ where: { itemNameDescriptionId: descId }, select: ['id'] })
    ).map((v) => v.id);

    const { sum: rawPrevC } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(COALESCE(tx.sqmofr, tx.sqm, 0))', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere('(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))', {
        currIds: tCurrPiiIds,
      })
      .getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;

    // prevAvgC from last prior PII among (G,S,SR) before that day’s start
    let prevAvgC = 0;
    const lastDescItem = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date <= :date', { date: cutoffDate })
      .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();
    if (lastDescItem && (lastDescItem as any).averageCostC != null) {
      prevAvgC = Number((lastDescItem as any).averageCostC);
    } else {
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({ where: { itemVariant: In(variantIdsForDesc) }, select: ['sqm', 'finalCostOfr'] });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce((s, o) => s + Number(o.sqm) * Number(o.finalCostOfr), 0);
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
    }

    const poItemsSameDesc = (targetInv.items ?? []).filter((it) => {
      const v = it.itemVariant ?? null;
      return v && v.itemNameDescriptionId === descId;
    });
    const poQtyC = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalOFR) * Number(it.sqm),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;

    const totalQtyC = prevQtyC + poQtyC;
    const newAvgC = totalQtyC > 0 ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC : poCostC;

    for (const it of poItemsSameDesc) {
      await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
        // keep any CVM previous fields NULL if your schema has them
        previousQuantityCVM: null,
        previousAverageCostCVM: null,
      });
         // 🔹 NEW: Mirror to ItemNameDescription — NO extra calculations
    if (poItemsSameDesc.length) {
      const lastRow = poItemsSameDesc[poItemsSameDesc.length - 1] as any;
      const lastCostC = Number(lastRow?.finalOFR ?? 0);

      console.log('[RECOMP C:G -> Desc] Mirroring C-values into ItemNameDescription:', {
        descId,
        averageCostC: newAvgC,
        lastCostC,
      });

      await this.descRepo.update(descId, {
        averageCostC: newAvgC,
        lastCostC,
      });
    }
    }
  }
};

/**
 * NEW: Recompute for a later S or SR invoice — Standard + C ONLY (skip VM)
 * Reason: a back-dated G changes only the OFR chain. VM chain (sqm/finalCost) is unaffected by G,
 * so we deliberately do not touch VM fields here.
 */
const recomputeInvoiceSOrSR_StandardOnly = async (targetId: number) => {
  const targetInv = await this.invoiceRepo.findOne({
    where: { id: targetId },
    relations: ['items', 'items.itemVariant'],
  });
  if (!targetInv) {
    console.warn('⚠️ Target invoice not found during forward recompute (S/SR std-only):', { targetId });
    return;
  }

  const cutoffDate = new Date(targetInv.date);
  const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
  console.log(
    `\n🔁 [RECOMP S/SR from G] Invoice ${targetInv.id} dated ${cutoffDate.toISOString().slice(0, 10)} — Standard + C ONLY (skip VM)`,
    { type: targetInv.type, itemCount: targetInv.items?.length ?? 0, tCurrPiiIds },
  );

  // Group for C-level
  const tItemsByDesc = new Map<number, any[]>();
  const tDescIds = new Set<number>();

  // STANDARD only per-PII
  for (const item of targetInv.items) {
    const iv =
      item.itemVariant ??
      (await this.variantRepo.findOne({
        where: { id: item.itemVariantId },
        select: ['id', 'itemNameDescriptionId', 'averageCost'],
      }));
    if (!iv) continue;

    const descId = iv.itemNameDescriptionId;
    if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
    tItemsByDesc.get(descId)!.push(item);
    tDescIds.add(descId);

    // prev qty STD = SUM(sqmofr) up to cutoff, excluding own rows
    const { sum: rawPrevStd } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere('(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))', {
        currIds: tCurrPiiIds,
      })
      .getRawOne();
    const prevQty = Number(rawPrevStd) || 0;
    const prevAvg = iv.averageCost ?? 0;

    const poQty = Number(item.sqm);
    const poCost = Number((item as any).finalOFR);
    const totalQty = prevQty + poQty;
    const newAvg = totalQty > 0 ? (prevAvg * prevQty + poCost * poQty) / totalQty : poCost;

    await this.itemRepo.update(item.id, {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,
      // DO NOT touch any VM fields here
    });
    await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
  }

  // C-level (same as your S logic; using OFR chain)
  console.log('[RECOMP C from G] start for invoice:', targetInv.id);
  for (const descId of tDescIds) {
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);

    const { sum: rawPrevC } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(COALESCE(tx.sqmofr, tx.sqm, 0))', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere('(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))', {
        currIds: tCurrPiiIds,
      })
      .getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;

    // previous avgC: keep your S-only baseline (or widen to S/SR if you want)
    let prevAvgC = 0;
    const lastDescItem = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G','S','SR'] })
      .andWhere('inv.date <= :date', { date: cutoffDate })
      .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();
    if (lastDescItem && (lastDescItem as any).averageCostC != null) {
      prevAvgC = Number((lastDescItem as any).averageCostC);
    } else {
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCostOfr'],
        });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce((s, o) => s + Number(o.sqm) * Number(o.finalCostOfr), 0);
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
    }

    const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalOFR) * Number(it.sqm),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
    const totalQtyC = prevQtyC + poQtyC;
    const newAvgC = totalQtyC > 0 ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC : poCostC;

    for (const it of poItemsSameDesc) {
      await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
        // DO NOT touch any VM fields here
      });
    }
  }
};

// --- Dispatch based on later invoice type
for (const r of laterRaw) {
  
  if (r.type === 'G') {
    await recomputeInvoiceG(r.id);
  } else if (r.type === 'S' || r.type === 'SR') {
    await recomputeInvoiceSOrSR_StandardOnly(r.id); // ⬅️ Standard + C only, skip VM
  }
}
console.log('🔁 [G] Forward recompute complete.');
  }

  console.log('🧾 [G] PO Cost Calc — End', { invoiceId: savedInvoice.id });
}
// 🔎 END: G-invoice block

// 🔎 BEGIN: SR-invoice block (hybrid: G for OFR/C, S for VM/CVM)
if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'SR') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous" lookups

  console.log('🧾 [SR] PO Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceType: savedInvoice.type,
    invoiceDateISO: invDate.toISOString(),
    cutoffForPreviousISO: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
    priorTypesForOFR: ['G', 'S', 'SR'],
  });

  const itemsByDesc = new Map<number, any[]>();

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 [SR] Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Collect description IDs
  const descIds = new Set<number>();

  /* ────────────────────────────────────────────────
     PER-PII LOOP: 
       - STANDARD/OFR & C → treat as G
       - VM & CVM → treat as S
     ──────────────────────────────────────────────── */
  for (const item of savedInvoice.items ?? []) {
    const variantt = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId', 'averageCost', 'averageCostVM'],
    });
    if (!variantt) {
      console.error(`❌ [SR] Variant ${item.itemVariantId} not found`);
      continue;
    }

    const vid = variantt.id;
    const descId = variantt.itemNameDescriptionId;

    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[STANDARD:SR] ► Processing PII ${item.id} (variantId=${vid}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log('[STANDARD:SR] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqmVM: Number(item.sqm),
      finalOFR: Number((item as any).finalOFR),
      finalCost: Number((item as any).finalCost),
    });

    /* -----------------------------------
       0) PREVIOUS AVERAGE (OFR) — G-style
       ----------------------------------- */
    const priorTypes = ['G', 'S', 'SR'] as const;
    const qbPrevPII = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: priorTypes })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCost AS avg_cost',
        'pii.averageCostVM AS avg_cost_vm',
        'pii.averageCostC AS avg_cost_c',
        'pii.averageCostCVM AS avg_cost_cvm',
        'inv.id AS inv_id',
        'inv.date AS inv_date',
        'inv.type AS inv_type',
      ]);

    try {
      // @ts-ignore
      console.log('[PREV PII:SR] SQL:', qbPrevPII.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[PREV PII:SR] Params:', qbPrevPII.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const prevPIIRaw = await qbPrevPII.getRawOne<{
      pii_id?: number;
      avg_cost?: string | number | null;
      avg_cost_vm?: string | number | null;
      avg_cost_c?: string | number | null;
      avg_cost_cvm?: string | number | null;
      inv_id?: number;
      inv_date?: Date;
      inv_type?: string;
    }>();
    console.log('[PREV PII:SR] raw result:', prevPIIRaw ?? null);

    /* -----------------------------------
       1) PREVIOUS QTY (OFR) from tx.sqmofr
       ----------------------------------- */
    const qbPrevQtyOFR = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevQtyOFR.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[STANDARD:SR] prevQty (OFR) SQL:', qbPrevQtyOFR.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[STANDARD:SR] prevQty (OFR) Params:', qbPrevQtyOFR.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    let prevQtyOFR = 0;
    const { sum: rawPrevOfr } = await qbPrevQtyOFR.getRawOne();
    prevQtyOFR = Number(rawPrevOfr) || 0;
    console.log('[STANDARD:SR] prevQty (OFR) result:', { rawPrevOfr, prevQtyOFR });

    /* -----------------------------------
       2) PREVIOUS AVG (OFR) — from prior PII or openings
       ----------------------------------- */
    let prevAvgOFR: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost != null) {
      prevAvgOFR = Number(prevPIIRaw.avg_cost);
      console.log('[STANDARD:SR] prevAvgOFR from previous PII.averageCost:', {
        prevAvgOFR,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInv: {
          id: prevPIIRaw.inv_id ?? null,
          type: prevPIIRaw.inv_type ?? null,
          date: prevPIIRaw.inv_date ?? null,
        },
      });
    } else {
      console.log('[STANDARD:SR] no previous PII; computing weighted openings from InventoryCount (OFR)…');
      const openings = await this.invTransRepo.manager.getRepository(InventoryCount).find({
        where: { itemVariant: { id: item.itemVariantId } },
        select: ['sqmOfr', 'finalCostOfr'],
      });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvgOFR = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

      console.log('[STANDARD:SR] openings snapshot + resolved prevAvgOFR:', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvgOFR,
      });
    }

    /* -----------------------------------
       3) CURRENT PO CONTRIBUTION (OFR side)
       ----------------------------------- */
    const poQtyOFR = Number(item.sqm); // SR: the sqm is used as OFR quantity (similar to G)
    const poCostOFR = Number((item as any).finalOFR);
    console.log('[STANDARD:SR] current PO contribution (OFR):', { poQtyOFR, poCostOFR });

    const totalQtyOFR = prevQtyOFR + poQtyOFR;
    const lhsOFR = prevAvgOFR * prevQtyOFR;
    const rhsOFR = poCostOFR * poQtyOFR;
    const newAvgOFR = totalQtyOFR > 0 ? (lhsOFR + rhsOFR) / totalQtyOFR : poCostOFR;

    console.log('[STANDARD:SR] blend details (OFR):', {
      formula: 'newAvgOFR = (prevAvgOFR*prevQtyOFR + poCostOFR*poQtyOFR) / (prevQtyOFR + poQtyOFR)',
      prevAvgOFR,
      prevQtyOFR,
      poCostOFR,
      poQtyOFR,
      lhsOFR,
      rhsOFR,
      totalQtyOFR,
      newAvgOFR,
      guardWhenTotalQtyIsZero: totalQtyOFR === 0 ? '(used poCostOFR)' : '(used blend)',
    });

    // Persist STANDARD/OFR into PII & Variant (G-logic)
    const piiStdUpdate = await this.itemRepo.update(item.id, {
      previousQuantity: prevQtyOFR,
      previousAverageCost: prevAvgOFR,
      averageCost: newAvgOFR,
    });
    console.log('✓ [STANDARD:SR] PII update result (OFR):', {
      piiId: item.id,
      affected: piiStdUpdate?.affected ?? 'n/a',
    });

    const varStdUpdate = await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvgOFR,
      lastCost: poCostOFR,
    });
    console.log('✓ [STANDARD:SR] Variant update result (OFR):', {
      itemVariantId: item.itemVariantId,
      affected: varStdUpdate?.affected ?? 'n/a',
      set: { averageCost: newAvgOFR, lastCost: poCostOFR },
    });

    /* -----------------------------------
       4) VM CHAIN (VM side) — S-style
       ----------------------------------- */
    const qbPrevVm = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevVm.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[VM:SR] prevQtyVM SQL:', qbPrevVm.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[VM:SR] prevQtyVM Params:', qbPrevVm.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevVm } = await qbPrevVm.getRawOne();
    const prevQtyVM = Number(rawPrevVm) || 0;
    console.log('[VM:SR] prevQtyVM result (VM chain):', { rawPrevVm, prevQtyVM });

    let prevAvgVM: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost_vm != null) {
      prevAvgVM = Number(prevPIIRaw.avg_cost_vm);
      console.log('[VM:SR] prevAvgVM from previous PII.averageCostVM:', {
        prevAvgVM,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInvId: prevPIIRaw.inv_id ?? null,
        prevInvDate: prevPIIRaw.inv_date ?? null,
      });
    } else {
      prevAvgVM = 0;
      console.log('[VM:SR] no previous PII found → prevAvgVM = 0');
    }

    const poQtyVM = Number(item.sqm);
    const poCostVM = Number((item as any).finalCost);
    const totalQtyVM = prevQtyVM + poQtyVM;
    const lhsVM = prevAvgVM * prevQtyVM;
    const rhsVM = poCostVM * poQtyVM;
    const newAvgVM = totalQtyVM > 0 ? (lhsVM + rhsVM) / totalQtyVM : poCostVM;

    console.log('[VM:SR] blend details (VM):', {
      formula: 'newAvgVM = (prevAvgVM*prevQtyVM + poCostVM*poQtyVM) / (prevQtyVM + poQtyVM)',
      prevAvgVM,
      prevQtyVM,
      poCostVM,
      poQtyVM,
      lhsVM,
      rhsVM,
      totalQtyVM,
      newAvgVM,
      guardWhenTotalQtyVMIsZero: totalQtyVM === 0 ? '(used poCostVM)' : '(used blend)',
    });

    const piiVmUpdate = await this.itemRepo.update(item.id, {
      previousQuantityVM: prevQtyVM,
      previousAverageCostVM: prevAvgVM,
      averageCostVM: newAvgVM,
    });
    console.log('✓ [VM:SR] PII update result (VM):', {
      piiId: item.id,
      affected: piiVmUpdate?.affected ?? 'n/a',
    });

    const varVmUpdate = await this.variantRepo.update(item.itemVariantId, {
      averageCostVM: newAvgVM,
      lastCostVM: poCostVM,
    });
    console.log('✓ [VM:SR] Variant update result (VM):', {
      itemVariantId: item.itemVariantId,
      affected: varVmUpdate?.affected ?? 'n/a',
      set: { averageCostVM: newAvgVM, lastCostVM: poCostVM },
    });
  } // end per-PII (SR main loop)

  /* ────────────────────────────────────────────────
     C-LEVEL (by description, current invoice) — OFR (G-style)
     ──────────────────────────────────────────────── */
  console.log('\n📚 [SR] C-Level (by description, OFR) calculations start');
  for (const descId of descIds) {
    console.log(`\n[C:SR] ► Description ${descId}`);

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[C:SR] variantIdsForDesc:', variantIdsForDesc);

    const qbPrevC = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );

    try {
      // @ts-ignore
      console.log('[C:SR] prevQtyC (OFR) SQL:', qbPrevC.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[C:SR] prevQtyC (OFR) Params:', qbPrevC.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevC } = await qbPrevC.getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;
    console.log('[C:SR] prevQtyC (OFR) result:', { rawPrevC, prevQtyC });

    // previous avgC — same idea as G: look at history G/S/SR before dayStart
    let prevAvgC: number;
    const lastDescItemC = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();

    if (lastDescItemC && (lastDescItemC as any).averageCostC != null) {
      prevAvgC = Number((lastDescItemC as any).averageCostC);
      console.log('[C:SR] prevAvgC from last PII.averageCostC:', prevAvgC);
    } else {
      console.log('[C:SR] no prior PII.averageCostC, compute from openings (OFR)…');
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqmOfr', 'finalCostOfr'],
        });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
      console.log('[C:SR] openings snapshot (OFR):', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvgC,
      });
    }

    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it: any) => s + Number((it as any).finalOFR ?? 0) * Number(it.sqm ?? 0),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;

    console.log('[C:SR] current PO group snapshot (OFR):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      poQtyC,
      weightedCostSum,
      poCostC,
    });

    const totalQtyC = prevQtyC + poQtyC;
    const lhsC = prevAvgC * prevQtyC;
    const rhsC = poCostC * poQtyC;
    const newAvgC = totalQtyC > 0 ? (lhsC + rhsC) / totalQtyC : poCostC;

    console.log('[C:SR] blend details (OFR):', {
      formula: 'newAvgC = (prevAvgC*prevQtyC + poCostC*poQtyC) / (prevQtyC + poQtyC)',
      prevAvgC,
      prevQtyC,
      poCostC,
      poQtyC,
      lhsC,
      rhsC,
      totalQtyC,
      newAvgC,
    });

    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
      });
      console.log('✓ [C:SR] PII row updated with C-values (OFR):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
      });
    }
  }

  /* ────────────────────────────────────────────────
     CVM-LEVEL (by description, current invoice) — VM (S-style)
     ──────────────────────────────────────────────── */
  console.log('\n📚 [SR] CVM-Level (by description, VM) calculations start');
  for (const descId of descIds) {
    console.log(`\n[CVM:SR] ► Description ${descId}`);

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[CVM:SR] variantIdsForDesc:', variantIdsForDesc);

    const qbPrevCVM = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );

    try {
      // @ts-ignore
      console.log('[CVM:SR] prevQtyCVM SQL:', qbPrevCVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[CVM:SR] prevQtyCVM Params:', qbPrevCVM.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevCVM } = await qbPrevCVM.getRawOne();
    const prevQtyCVM = Number(rawPrevCVM) || 0;
    console.log('[CVM:SR] prevQtyCVM result (VM):', { rawPrevCVM, prevQtyCVM });

    let prevAvgCVM: number;
    const lastDescItemCVM = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostCVM'])
      .getOne();

    if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
      prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
      console.log('[CVM:SR] prevAvgCVM from last PII.averageCostCVM:', prevAvgCVM);
    } else {
      console.log('[CVM:SR] no prior PII.averageCostCVM, compute from openings (VM)…');
      const openingsVM = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCost'],
        });

      const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm ?? 0), 0);
      const weightedSumVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
        0,
      );
      prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
      console.log('[CVM:SR] openings snapshot (VM):', {
        openingsCount: openingsVM.length,
        totalOpenQtyVM,
        weightedSumVM,
        prevAvgCVM,
      });
    }

    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyCVM = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
    const weightedCostSumVM = poItemsSameDesc.reduce(
      (s, it: any) => s + Number((it as any).finalCost ?? 0) * Number(it.sqm ?? 0),
      0,
    );
    const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

    console.log('[CVM:SR] current PO group snapshot (VM):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      poQtyCVM,
      weightedCostSumVM,
      poCostCVM,
    });

    const totalQtyCVM = prevQtyCVM + poQtyCVM;
    const lhsCVM = prevAvgCVM * prevQtyCVM;
    const rhsCVM = poCostCVM * poQtyCVM;
    const newAvgCVM = totalQtyCVM > 0 ? (lhsCVM + rhsCVM) / totalQtyCVM : poCostCVM;

    console.log('[CVM:SR] blend details (VM):', {
      formula: 'newAvgCVM = (prevAvgCVM*prevQtyCVM + poCostCVM*poQtyCVM) / (prevQtyCVM + poQtyCVM)',
      prevAvgCVM,
      prevQtyCVM,
      poCostCVM,
      poQtyCVM,
      lhsCVM,
      rhsCVM,
      totalQtyCVM,
      newAvgCVM,
    });

    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      });
      console.log('✓ [CVM:SR] PII row updated with CVM-values (VM):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
      });
    }
  }

  /* ────────────────────────────────────────────────
     FINAL WRITE → UPDATE ItemNameDescription
     (no recalculation — mirror C & CVM from PII)
     ──────────────────────────────────────────────── */
  console.log('\n🗂 [SR] Writing final ItemNameDescription costs…');

  for (const descId of descIds) {
    const poRows = itemsByDesc.get(descId) ?? [];

    if (!poRows.length) {
      console.warn(`⚠️ [SR] No PO rows found for descId: ${descId}, skipping…`);
      continue;
    }

    const ref = poRows[0] as any;
    const fresh = await this.itemRepo.findOne({ where: { id: ref.id } });

    const lastRow = poRows[poRows.length - 1] as any;

    const finalWrite = {
      averageCostC: Number(fresh?.averageCostC ?? 0),
      averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
      lastCostC: Number(lastRow?.finalOFR ?? 0),
      lastCostCVM: Number(lastRow?.finalCost ?? 0),
    };

    console.log(`📝 [SR] Updating Description ${descId} with:`, finalWrite);

    await this.descRepo.update(descId, finalWrite);

    console.log(`✓ [SR] Updated ItemNameDescription ${descId}`);
  }

  console.log('🧾 [SR] ItemNameDescription update (final) completed.');

  /* ────────────────────────────────────────────────
     FORWARD RECOMPUTE FOR LATER S / SR POs
     - SR affects BOTH OFR & VM chains
     - We recompute later S / SR invoices with same hybrid logic
     ──────────────────────────────────────────────── */
  const affectedVariantIds = Array.from(
    new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)),
  );
  const affectedDescIds = Array.from(descIds);

  if (affectedVariantIds.length || affectedDescIds.length) {
    console.log('🔁 [SR] Checking for later POs to recompute…', {
      affectedVariantIds,
      affectedDescIds,
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['S', 'SR'] })
      .andWhere('inv.date > :cut', { cut: invDate })
      .andWhere(`(iv.id IN (:...varIds) OR iv.itemNameDescriptionId IN (:...descIds))`, {
        varIds: affectedVariantIds.length ? affectedVariantIds : [-1],
        descIds: affectedDescIds.length ? affectedDescIds : [-1],
      })
      .select('inv.id', 'id')
      .addSelect('inv.type', 'type')
      .addSelect('inv.date', 'date')
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; type: 'S' | 'SR'; date: Date }>();

    const laterIds = laterRaw.map((r) => r.id);
    console.log('🔁 [SR] Later PO IDs to recompute (S/SR):', laterIds, { meta: laterRaw });

    // Hybrid recompute: OFR/C = G-logic, VM/CVM = S-logic
    const recomputeInvoiceHybridSR = async (targetId: number) => {
      const targetInv = await this.invoiceRepo.findOne({
        where: { id: targetId },
        relations: ['items', 'items.itemVariant'],
      });
      if (!targetInv) {
        console.warn('⚠️ [SR] Target invoice not found during forward recompute:', { targetId });
        return;
      }

      const cutoffDate = new Date(targetInv.date);
      const tDayStart = new Date(cutoffDate);
      tDayStart.setHours(0, 0, 0, 0);

      const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
      console.log(
        `\n🔁 [RECOMP:SR] Invoice ${targetInv.id} dated ${cutoffDate
          .toISOString()
          .slice(0, 10)} — Hybrid recompute (OFR like G, VM like S)`,
        { type: targetInv.type, itemCount: targetInv.items?.length ?? 0, tCurrPiiIds },
      );

      const tItemsByDesc = new Map<number, any[]>();
      const tDescIds = new Set<number>();

      // per-PII hybrid
      for (const item of targetInv.items ?? []) {
        const iv =
          item.itemVariant ??
          (await this.variantRepo.findOne({
            where: { id: item.itemVariantId },
            select: ['id', 'itemNameDescriptionId', 'averageCost', 'averageCostVM'],
          }));
        if (!iv) {
          console.warn('⚠️ [RECOMP:SR] Variant missing for PII:', item.id);
          continue;
        }
        const descId = iv.itemNameDescriptionId;

        if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
        tItemsByDesc.get(descId)!.push(item);
        tDescIds.add(descId);

        // prev PII for OFR (G-style)
        const qbPrevPII_R = this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
          .andWhere('inv.date < :cutoff', { cutoff: tDayStart })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select([
            'pii.id AS pii_id',
            'pii.averageCost AS avg_cost',
            'pii.averageCostVM AS avg_cost_vm',
          ]);

        const prevPIIRaw_R = await qbPrevPII_R.getRawOne<{
          pii_id?: number;
          avg_cost?: string | number | null;
          avg_cost_vm?: string | number | null;
        }>();

        // prevQty OFR
        const qbPrevQtyOFR_R = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        const { sum: rawPrevOfr_R } = await qbPrevQtyOFR_R.getRawOne();
        const prevQtyOFR_R = Number(rawPrevOfr_R) || 0;

        let prevAvgOFR_R: number;
        if (prevPIIRaw_R && prevPIIRaw_R.avg_cost != null) {
          prevAvgOFR_R = Number(prevPIIRaw_R.avg_cost);
        } else {
          const openings = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: { id: item.itemVariantId } },
              select: ['sqmOfr', 'finalCostOfr'],
            });
          const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
          const weightedSum = openings.reduce(
            (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
            0,
          );
          prevAvgOFR_R = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
        }

        const poQtyOFR_R = Number(item.sqm);
        const poCostOFR_R = Number((item as any).finalOFR);
        const totalQtyOFR_R = prevQtyOFR_R + poQtyOFR_R;
        const newAvgOFR_R =
          totalQtyOFR_R > 0
            ? (prevAvgOFR_R * prevQtyOFR_R + poCostOFR_R * poQtyOFR_R) / totalQtyOFR_R
            : poCostOFR_R;

        await this.itemRepo.update(item.id, {
          previousQuantity: prevQtyOFR_R,
          previousAverageCost: prevAvgOFR_R,
          averageCost: newAvgOFR_R,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCost: newAvgOFR_R,
          lastCost: poCostOFR_R,
        });

        // VM side (S-style)
        const qbPrevVm_R = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        const { sum: rawPrevVm_R } = await qbPrevVm_R.getRawOne();
        const prevQtyVM_R = Number(rawPrevVm_R) || 0;

        let prevAvgVM_R = 0;
        if (prevPIIRaw_R && prevPIIRaw_R.avg_cost_vm != null) {
          prevAvgVM_R = Number(prevPIIRaw_R.avg_cost_vm);
        }

        const poQtyVM_R = Number(item.sqm);
        const poCostVM_R = Number((item as any).finalCost);
        const totalQtyVM_R = prevQtyVM_R + poQtyVM_R;
        const newAvgVM_R =
          totalQtyVM_R > 0
            ? (prevAvgVM_R * prevQtyVM_R + poCostVM_R * poQtyVM_R) / totalQtyVM_R
            : poCostVM_R;

        await this.itemRepo.update(item.id, {
          previousQuantityVM: prevQtyVM_R,
          previousAverageCostVM: prevAvgVM_R,
          averageCostVM: newAvgVM_R,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCostVM: newAvgVM_R,
          lastCostVM: poCostVM_R,
        });
      } // end per-PII

      // C & CVM levels for this target, using same logic as main SR block
      console.log('\n[RECOMP C:SR] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const { sum: rawPrevC } = await this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          )
          .getRawOne();
        const prevQtyC = Number(rawPrevC) || 0;

        let prevAvgC = 0;
        const lastDescItem = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
          .andWhere('inv.date < :date', { date: tDayStart })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostC'])
          .getOne();
        if (lastDescItem && (lastDescItem as any).averageCostC != null) {
          prevAvgC = Number((lastDescItem as any).averageCostC);
        } else {
          const openings = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqmOfr', 'finalCostOfr'],
            });
          const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
          const weightedSum = openings.reduce(
            (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
            0,
          );
          prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyC = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
        const weightedCostSum = poItemsSameDesc.reduce(
          (s, it: any) => s + Number((it as any).finalOFR ?? 0) * Number(it.sqm ?? 0),
          0,
        );
        const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
        const totalQtyC = prevQtyC + poQtyC;
        const newAvgC =
          totalQtyC > 0
            ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC
            : poCostC;

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityC: prevQtyC,
            previousAverageCostC: prevAvgC,
            averageCostC: newAvgC,
          });
        }
      }

      console.log('\n[RECOMP CVM:SR] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const { sum: rawPrevCVM } = await this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          )
          .getRawOne();
        const prevQtyCVM = Number(rawPrevCVM) || 0;

        let prevAvgCVM = 0;
        const lastDescItemCVM = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
          .andWhere('inv.date < :date', { date: tDayStart })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostCVM'])
          .getOne();
        if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
          prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
        } else {
          const openingsVM = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqm', 'finalCost'],
            });
          const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm ?? 0), 0);
          const weightedSumVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
            0,
          );
          prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyCVM = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
        const weightedCostSumVM = poItemsSameDesc.reduce(
          (s, it: any) => s + Number((it as any).finalCost ?? 0) * Number(it.sqm ?? 0),
          0,
        );
        const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;
        const totalQtyCVM = prevQtyCVM + poQtyCVM;
        const newAvgCVM =
          totalQtyCVM > 0
            ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalQtyCVM
            : poCostCVM;

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityCVM: prevQtyCVM,
            previousAverageCostCVM: prevAvgCVM,
            averageCostCVM: newAvgCVM,
          });
        }
      }

      // mirror into ItemNameDescription
      console.log('\n[RECOMP DESC:SR] Updating ItemNameDescription based on recomputed rows…');
      for (const descId of tDescIds) {
        const rows = tItemsByDesc.get(descId) ?? [];
        if (!rows.length) {
          console.warn(`⚠️ [RECOMP DESC:SR] No matching rows for descId ${descId} during recompute.`);
          continue;
        }

        const ref = rows[0] as any;
        const fresh = await this.itemRepo.findOne({ where: { id: ref.id } });
        const lastRow = rows[rows.length - 1] as any;

        const updateValues = {
          averageCostC: Number(fresh?.averageCostC ?? 0),
          averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
          lastCostC: Number(lastRow?.finalOFR ?? 0),
          lastCostCVM: Number(lastRow?.finalCost ?? 0),
        };

        console.log(`[RECOMP DESC:SR] Writing to Description ${descId}:`, updateValues);
        await this.descRepo.update(descId, updateValues);
      }
    };

    for (const row of laterRaw) {
      await recomputeInvoiceHybridSR(row.id);
    }

    console.log('🔁 [SR] Forward recompute complete.');
  }

  console.log('🧾 [SR] PO Cost Calc — End', { invoiceId: savedInvoice.id });
}
// 🔎 END: SR-invoice block



// 🔎 BEGIN: RVR Cost-calculation & logging block (VM + CVM)
// NOTE: This block computes per-PII VM and per-description CVM for RVR invoices.
//       Forward recompute covers RVR (VM + CVM) and S/SR (your full logic).
if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'RVR') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous PII" lookups

  console.log('🧾 RVR Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceType: savedInvoice.type,
    invoiceDate: invDate.toISOString(),
    cutoffForPreviousPII: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
  });

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Track affected variants for forward recompute
  const affectedVariantIds = Array.from(new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)));

  // For CVM: collect items by description for THIS invoice
  const itemsByDesc = new Map<number, any[]>();
  const descIds = new Set<number>();

  // ─────────────────────────────────────────────────────────
  // Per-PII: VM track (RVR)
  // ─────────────────────────────────────────────────────────
  for (const item of savedInvoice.items) {
    // Need description id to group later for CVM
    const variant = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId'],
    });
    if (!variant) {
      console.error(`❌ Variant ${item.itemVariantId} not found`);
      continue;
    }

    // collect for CVM grouping
    const descId = variant.itemNameDescriptionId;
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[RVR:VM] ► Processing PII ${item.id} (variantId=${variant.id}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log('[RVR:VM] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqm: Number(item.sqm),
      finalCost: Number((item as any).finalCost),
    });

    // 0) Previous AVERAGE VM from last settled PII before dayStart across S/SR/RVR
    const qbPrevPIIVM = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCostVM AS avg_cost_vm',
        'inv.id AS inv_id',
        'inv.type AS inv_type',
        'inv.date AS inv_date',
      ]);

    try {
      // @ts-ignore
      console.log('[RVR:VM prevPII] SQL:', qbPrevPIIVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[RVR:VM prevPII] Params:', qbPrevPIIVM.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const prevPIIVMRaw = await qbPrevPIIVM.getRawOne<{
      pii_id?: number;
      avg_cost_vm?: string | number | null;
      inv_id?: number;
      inv_type?: string;
      inv_date?: Date;
    }>();

    console.log('[RVR:VM prevPII] raw result:', prevPIIVMRaw ?? null);

    // 1) Previous qty (VM uses SUM(tx.sqm)) — inclusive cutoff, excluding current invoice rows
    const qbPrevVm = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevVm.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[RVR:VM prevQty] SQL:', qbPrevVm.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[RVR:VM prevQty] Params:', qbPrevVm.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevVm } = await qbPrevVm.getRawOne();
    const prevQtyVM = Number(rawPrevVm) || 0;
    console.log('[RVR:VM prevQty] result:', { rawPrevVm, prevQtyVM });

    // 2) Previous avg VM
    let prevAvgVM: number;
    if (prevPIIVMRaw && prevPIIVMRaw.avg_cost_vm != null) {
      prevAvgVM = Number(prevPIIVMRaw.avg_cost_vm);
      console.log('[RVR:VM prevAvg] from previous PII.averageCostVM:', {
        prevAvgVM,
        prevPiiId: prevPIIVMRaw.pii_id ?? null,
        prevInvId: prevPIIVMRaw.inv_id ?? null,
        prevInvType: prevPIIVMRaw.inv_type ?? null,
        prevInvDate: prevPIIVMRaw.inv_date ?? null,
      });
    } else {
      prevAvgVM = 0;
      console.log('[RVR:VM prevAvg] no previous PII found → prevAvgVM = 0');
    }

    // 3) Current row (VM)
    const poQtyVM = Number(item.sqm);
    const poCostVM = Number((item as any).finalCost);
    console.log('[RVR:VM current PO contribution:', { poQtyVM, poCostVM });

    // 4) Blend (VM)
    const totalQtyVM = prevQtyVM + poQtyVM;
    const lhsVM = prevAvgVM * prevQtyVM;
    const rhsVM = poCostVM * poQtyVM;
    const newAvgVM = totalQtyVM > 0 ? (lhsVM + rhsVM) / totalQtyVM : poCostVM;
    console.log('[RVR:VM blend details]', {
      formula: 'newAvgVM = (prevAvgVM*prevQtyVM + poCostVM*poQtyVM) / (prevQtyVM + poQtyVM)',
      prevAvgVM,
      prevQtyVM,
      poCostVM,
      poQtyVM,
      lhsVM,
      rhsVM,
      totalQtyVM,
      newAvgVM,
      guardWhenTotalQtyVMIsZero: totalQtyVM === 0 ? '(used poCostVM)' : '(used blend)',
    });

    // 5) Persist PII: VM filled; Standard & C cleared for RVR
    const piiUpdateRes = await this.itemRepo.update(item.id, {
      previousQuantity: null,
      previousAverageCost: null,
      // keep averageCost as-is (or null it if you want)
      previousQuantityC: null,
      previousAverageCostC: null,
      averageCostC: null,

      previousQuantityVM: prevQtyVM,
      previousAverageCostVM: prevAvgVM,
      averageCostVM: newAvgVM,
    });
    console.log('✓ [RVR:VM] PII update result:', {
      piiId: item.id,
      affected: piiUpdateRes?.affected ?? 'n/a',
      set: {
        previousQuantity: null,
        previousAverageCost: null,
        previousQuantityC: null,
        previousAverageCostC: null,
        averageCostC: null,
        previousQuantityVM: prevQtyVM,
        previousAverageCostVM: prevAvgVM,
        averageCostVM: newAvgVM,
      },
    });

    // 6) Persist Variant (VM only)
    const varUpdateResVM = await this.variantRepo.update(item.itemVariantId, {
      averageCostVM: newAvgVM,
      lastCostVM: poCostVM,
    });
    console.log('✓ [RVR:VM] Variant update result:', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResVM?.affected ?? 'n/a',
      set: { averageCostVM: newAvgVM, lastCostVM: poCostVM },
    });
  } // end per-PII VM loop

  // ─────────────────────────────────────────────────────────
  // CVM-LEVEL (by description) for CURRENT RVR invoice
  // Uses SUM(tx.sqm) and finalCost; prev avg from last PII.averageCostCVM across RVR/S/SR
  // ─────────────────────────────────────────────────────────
  console.log('\n📚 CVM-Level (by description) calculations start (RVR)');
  for (const descId of descIds) {
    console.log(`\n[CVM] ► Description ${descId}`);

    // variants under this description
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[CVM] variantIdsForDesc:', variantIdsForDesc);

    // previous qty (VM chain): SUM(tx.sqm) up to & INCLUDING invDate; exclude current PO rows
    const qbPrevCVM = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevCVM.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[CVM] prevQtyCVM SQL:', qbPrevCVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[CVM] prevQtyCVM Params:', qbPrevCVM.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevCVM } = await qbPrevCVM.getRawOne();
    const prevQtyCVM = Number(rawPrevCVM) || 0;
    console.log('[CVM] prevQtyCVM result:', { rawPrevCVM, prevQtyCVM });

    // previous avgCVM from last settled PII.averageCostCVM (RVR/S/SR) on/before invDate (exclude current invoice)
    let prevAvgCVM: number;
    const lastDescItemCVM = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostCVM'])
      .getOne();

    if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
      prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
      console.log('[CVM] prevAvgCVM from last PII.averageCostCVM:', prevAvgCVM);
    } else {
      console.log('[CVM] no prior PII.averageCostCVM, compute from openings (VM)…');
      const openingsVM = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCost'],
        });

      const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSumVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm) * Number((o as any).finalCost ?? 0),
        0,
      );
      prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
      console.log('[CVM] openings snapshot:', {
        openingsCount: openingsVM.length,
        totalOpenQtyVM,
        weightedSumVM,
        prevAvgCVM,
      });
    }

    // group CURRENT RVR rows of this description — VM chain: sqm + finalCost
    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyCVM = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSumVM = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
      0,
    );
    const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

    console.log('[CVM] current PO group snapshot (VM):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x) => ({
        piiId: x.id,
        sqm: Number(x.sqm),
        finalCost: Number((x as any).finalCost),
      })),
      poQtyCVM,
      weightedCostSumVM,
      poCostCVM,
    });

    // blend (weighted-average) for CVM
    const totalQtyCVM = prevQtyCVM + poQtyCVM;
    const lhsCVM = prevAvgCVM * prevQtyCVM;
    const rhsCVM = poCostCVM * poQtyCVM;
    const newAvgCVM = totalQtyCVM > 0 ? (lhsCVM + rhsCVM) / totalQtyCVM : poCostCVM;
    console.log('[CVM] blend details:', {
      formula: 'newAvgCVM = (prevAvgCVM*prevQtyCVM + poCostCVM*poQtyCVM) / (prevQtyCVM + poQtyCVM)',
      prevAvgCVM,
      prevQtyCVM,
      poCostCVM,
      poQtyCVM,
      lhsCVM,
      rhsCVM,
      totalQtyCVM,
      newAvgCVM,
      guardWhenTotalQtyCVMIsZero: totalQtyCVM === 0 ? '(used poCostCVM)' : '(used blend)',
    });

    // write SAME CVM values to ALL PII rows of this description on THIS RVR invoice
    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      });
      console.log('✓ [CVM] PII row updated with CVM-values:', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: {
          previousQuantityCVM: prevQtyCVM,
          previousAverageCostCVM: prevAvgCVM,
          averageCostCVM: newAvgCVM,
        },
      });
    }
  } // end CVM loop

  // ─────────────────────────────
  // ⚙️ Forward recompute for back-dated inserts: later invoices of types RVR/S/SR
  // ─────────────────────────────
  if (affectedVariantIds.length) {
    console.log('🔁 Checking for later invoices to recompute…', {
      affectedVariantIds,
      includeTypes: ['RVR', 'S', 'SR'],
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
      .andWhere('inv.date > :cut', { cut: invDate })
      .andWhere('iv.id IN (:...varIds)', { varIds: affectedVariantIds })
      .select(['inv.id AS id', 'inv.date AS date', 'inv.type AS type'])
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; date: Date; type: 'RVR' | 'S' | 'SR' }>();

    const laterIds = laterRaw.map((r) => r.id);
    console.log('🔁 Later invoice IDs to recompute (RVR/S/SR):', laterIds);

    // Helper: recompute VM + CVM for a later RVR invoice
    const recomputeInvoiceRVR = async (targetId: number) => {
      const targetInv = await this.invoiceRepo.findOne({
        where: { id: targetId },
        relations: ['items', 'items.itemVariant'],
      });
      if (!targetInv) {
        console.warn('⚠️ Target invoice not found during forward recompute (RVR):', { targetId });
        return;
      }
      const cutoffDate = new Date(targetInv.date);
      const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);

      console.log(
        `\n🔁 [RVR:VM] Recomputing invoice ${targetInv.id} dated ${cutoffDate
          .toISOString()
          .slice(0, 10)} (VM + CVM)`,
        { itemCount: targetInv.items?.length ?? 0 },
      );

      // Collect for CVM grouping
      const tItemsByDesc = new Map<number, any[]>();
      const tDescIds = new Set<number>();

      // Per-PII VM recompute
      for (const item of targetInv.items) {
        // Only if variant was affected
        if (!affectedVariantIds.includes(item.itemVariantId)) continue;

        const descId = item.itemVariant?.itemNameDescriptionId;
        if (descId != null) {
          if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
          tItemsByDesc.get(descId)!.push(item);
          tDescIds.add(descId);
        }

        // prev qty VM
        const qbRPrevVm = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );

        try {
          // @ts-ignore
          console.log('[RECOMP RVR:VM prevQty] SQL:', qbRPrevVm.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP RVR:VM prevQty] Params:', qbRPrevVm.getParameters?.() ?? '(params not available)');
        } catch { /* noop */ }

        const { sum: rawPrevVm } = await qbRPrevVm.getRawOne();
        const prevQtyVM = Number(rawPrevVm) || 0;

        // prev avg VM from previous PII among S/SR/RVR (before this target date)
        const qbPrevPIIVM2 = this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
          .andWhere('inv.date < :cutoff', { cutoff: cutoffDate })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostVM AS avg_cost_vm', 'inv.id AS inv_id', 'inv.type AS inv_type', 'inv.date AS inv_date']);

        const prevPIIVM2 = await qbPrevPIIVM2.getRawOne<{ avg_cost_vm?: number | string | null }>();
        let prevAvgVM = prevPIIVM2?.avg_cost_vm != null ? Number(prevPIIVM2.avg_cost_vm) : 0;

        // blend VM
        const poQtyVM = Number(item.sqm);
        const poCostVM = Number((item as any).finalCost);
        const totalQtyVM = prevQtyVM + poQtyVM;
        const newAvgVM = totalQtyVM > 0 ? (prevAvgVM * prevQtyVM + poCostVM * poQtyVM) / totalQtyVM : poCostVM;

        console.log('[RECOMP RVR:VM details]', {
          piiId: item.id,
          itemVariantId: item.itemVariantId,
          prevQtyVM,
          prevAvgVM,
          poQtyVM,
          poCostVM,
          totalQtyVM,
          newAvgVM,
        });

        await this.itemRepo.update(item.id, {
          // enforce nulls for Standard & C in RVR
          previousQuantity: null,
          previousAverageCost: null,
          previousQuantityC: null,
          previousAverageCostC: null,
          averageCostC: null,

          // VM fields
          previousQuantityVM: prevQtyVM,
          previousAverageCostVM: prevAvgVM,
          averageCostVM: newAvgVM,
        });

        await this.variantRepo.update(item.itemVariantId, {
          averageCostVM: newAvgVM,
          lastCostVM: poCostVM,
        });
      } // end per-PII VM recompute

      // CVM recompute (by description) for this later RVR
      console.log('\n[RECOMP CVM] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        // previous qty CVM (VM chain)
        const qbRPrevCVM = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM SQL:', qbRPrevCVM.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM Params:', qbRPrevCVM.getParameters?.() ?? '(params not available)');
        } catch { /* noop */ }

        const { sum: rawPrevCVM } = await qbRPrevCVM.getRawOne();
        const prevQtyCVM = Number(rawPrevCVM) || 0;

        // previous avgCVM from last PII.averageCostCVM across RVR/S/SR on/before cutoffDate (exclude current)
        let prevAvgCVM = 0;
        const lastDescItemCVM = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('inv.date <= :date', { date: cutoffDate })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostCVM'])
          .getOne();

        if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
          prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
        } else {
          const openingsVM = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqm', 'finalCost'],
            });

          const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm), 0);
          const weightedSumVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm) * Number((o as any).finalCost ?? 0),
            0,
          );
          prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyCVM = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
        const weightedCostSumVM = poItemsSameDesc.reduce(
          (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
          0,
        );
        const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

        const totalQtyCVM = prevQtyCVM + poQtyCVM;
        const newAvgCVM =
          totalQtyCVM > 0 ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalQtyCVM : poCostCVM;

        console.log('[RECOMP CVM] details:', {
          descId,
          prevQtyCVM,
          prevAvgCVM,
          poQtyCVM,
          weightedCostSumVM,
          poCostCVM,
          totalQtyCVM,
          newAvgCVM,
        });

        // Persist to all PII in this description (on the target RVR invoice)
        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityCVM: prevQtyCVM,
            previousAverageCostCVM: prevAvgCVM,
            averageCostCVM: newAvgCVM,
          });
        }
      } // end RECOMP CVM loop
    };

    // Helper: recompute S/SR invoice (kept as you wrote it)
    const recomputeInvoiceSOrSR = async (targetId: number) => {
      // ... (unchanged from your snippet)
      // If you also want CVM on S/SR here, mirror the CVM loop used above.
      // (You already added CVM in your S block elsewhere.)
      // -- omitted for brevity --
    };

    for (const r of laterRaw) {
      if (r.type === 'RVR') {
        await recomputeInvoiceRVR(r.id);
      } else if (r.type === 'S' || r.type === 'SR') {
        await recomputeInvoiceSOrSR(r.id);
      }
    }
    console.log('🔁 Forward recompute complete for later RVR/S/SR invoices.');
  }

  console.log('🧾 RVR Cost Calc — End', { invoiceId: savedInvoice.id });
}
// 🔎 END: RVR Cost-calculation & logging block

await this.recomputeVariantCostsAfterPurchaseEdit({
  cutoffDate: savedInvoice.date,
  affectedVariantIds: savedInvoice.items.map(i => Number(i.itemVariantId)).filter(Boolean),
});


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
): Promise<void> {
  const PREFIX = '[rebuildInventoryForPurchaseInvoice]';

  if (!savedInvoice || savedInvoice.status !== 'Recieved') return;

  const items = savedInvoice.items ?? [];
  if (!items.length) return;

  const invoiceDate = new Date(savedInvoice.date);

  console.log(PREFIX, 'Start rebuild for invoice:', {
    id: savedInvoice.id,
    type: savedInvoice.type,
    date: savedInvoice.jvDate,
    invoiceDate,
    itemsCount: items.length,
  });

  const itemIds = items.map((it: any) => it.id);
  console.log(PREFIX, 'Invoice item IDs:', itemIds);

  // ─────────────────────────────────────────────
  // 0) Remove old inventory tx rows for this invoice
  //    but remember which batchId each item used
  // ─────────────────────────────────────────────
  const existingTxs = await this.inventoryTxRepo.find({
    where: { purchaseInvoiceItemId: In(itemIds) },
  });
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
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // 2) Recalculate batch totals FROM inventory_transaction
  //    ❗ ONLY FROM PURCHASE TXs (not start counts etc.)
  // ─────────────────────────────────────────────
  const affectedBatchIds = Array.from(
    new Set(invTxs.map((tx) => tx.itemBatchId).filter((id) => id != null) as number[]),
  );
  console.log(PREFIX, 'Affected batch IDs:', affectedBatchIds);

  for (const batchId of affectedBatchIds) {
    const batch = await this.itemBatchRepo.findOne({ where: { id: batchId } });
    if (!batch) {
      console.warn(PREFIX, 'Batch not found when recomputing:', { batchId });
      continue;
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
  // ─────────────────────────────────────────────
  const affectedVariantIds = Array.from(
    new Set(items.map((it: any) => Number(it.itemVariantId)).filter(Boolean)),
  );
  console.log(PREFIX, 'Affected variant IDs:', affectedVariantIds);

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
  const incomingItems = (incomingItemsPayload ?? []).map((it: any) => ({ ...it }));
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
  // ─────────────────────────────────────────────
  if (prevItemIds.length) {
    await this.inventoryTxRepo.delete({
      purchaseInvoiceItemId: In(prevItemIds),
    });
  }

  // Use existing (which already has items) to rebuild inventory
  await this.rebuildInventoryForPurchaseInvoice({
    ...(savedInvoice as any),
    items: existing.items,
  } as PurchaseInvoice);

  // ─────────────────────────────────────────────
  // 4.2) delete/rebuild JV (if you want JV to follow edits as well)
  //      - here you would delete existing JV(s) for this invoice
  //      - then call the same JV creation logic you use in `create`
  // ─────────────────────────────────────────────
  // e.g.:
  // await this.journalVoucherRepo.delete({ purchaseInvoiceId: savedInvoice.id });
  // await this.createOrRebuildJVForPurchaseInvoice(savedInvoice, existing.items, incomingUnitPriceRowsPayload);

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

 



  // ─────────────────────────────────────────────────────────
  // 7) COST-CALCULATION BLOCKS (EXACTLY your create’s logic)
  //    S / G / RVR with forward recompute
  // ─────────────────────────────────────────────────────────

if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'S') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous" lookups

  console.log('🧾 PO Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceDate: invDate.toISOString(),
    cutoffForPrevious: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
  });

  const itemsByDesc = new Map<number, any[]>();

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Collect description IDs
  const descIds = new Set<number>();

  /* ────────────────────────────────────────────────
     PER-PII LOOP: STANDARD (OFR) + VM (VM)
     ──────────────────────────────────────────────── */
  for (const item of savedInvoice.items) {
    // ───────── STANDARD COST TRACK ─────────
    const variantt = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId', 'averageCost', 'averageCostVM'],
    });
    if (!variantt) {
      console.error(`❌ Variant ${item.itemVariantId} not found`);
      continue;
    }

    const vid = variantt.id;
    const descId = variantt.itemNameDescriptionId;

    // collect this PII under its description
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[STANDARD] ► Processing PII ${item.id} (variantId=${vid}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log(`[STANDARD]   invoice date (PO):`, invDate);
    console.log('[STANDARD] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqm: Number(item.sqm),
      sqmOfr: Number((item as any).sqm ?? 0),
      finalOFR: Number((item as any).finalOFR),
      finalCost: Number((item as any).finalCost),
    });

    // 0) Determine PREVIOUS AVERAGE (STANDARD / OFR chain)
    const qbPrevPII = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCost AS avg_cost',
        'pii.averageCostVM AS avg_cost_vm',
        'inv.id AS inv_id',
        'inv.date AS inv_date',
      ]);

    try {
      // @ts-ignore
      console.log('[PREV PII] SQL:', qbPrevPII.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[PREV PII] Params:', qbPrevPII.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }

    const prevPIIRaw = await qbPrevPII.getRawOne<{
      pii_id?: number;
      avg_cost?: string | number | null;
      avg_cost_vm?: string | number | null;
      inv_id?: number;
      inv_date?: Date;
    }>();

    console.log('[PREV PII] raw result:', prevPIIRaw ?? null);

    // 1) Sum prior sqm-OFR (EXCLUDING current invoice items) — inclusive cutoff
    const qbPrev = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: invDate });

    if (hasCurrPiiIds) {
      qbPrev.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[STANDARD] prevQty SQL:', qbPrev.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[STANDARD] prevQty Params:', qbPrev.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }
// 1) Determine previous quantity logic based on whether a previous PII exists or not
let prevQty = 0;

if (prevPIIRaw) {
  // There IS a previous settled PO → use historical inventory tx before this invoice
  const { sum: rawPrev } = await qbPrev.getRawOne();
  prevQty = Number(rawPrev) || 0;
  console.log(`[STANDARD] Using historical qty (since previous PII exists): prevQty = ${prevQty}`);
} else {
  // NO previous invoice → use ONLY opening stock (if any)
const openingRecord = await this.invTransRepo.manager
  .getRepository(InventoryCount)
  .createQueryBuilder('ic')
  .select('ic.sqmOfr', 'sqmOfr')
  .where('ic.itemVariantId = :vid', { vid: item.itemVariantId })
  .limit(1)
  .getRawOne();

prevQty = Number(openingRecord?.sqmOfr ?? 0);
console.log(`[STANDARD] No prior PII → using opening stock only: prevQty = ${prevQty}`);

}

    // 2) Prev avg-OFR (STANDARD)
    let prevAvg: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost != null) {
      prevAvg = Number(prevPIIRaw.avg_cost);
      console.log('[STANDARD] prevAvg from previous PII.averageCost:', {
        prevAvg,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInvId: prevPIIRaw.inv_id ?? null,
        prevInvDate: prevPIIRaw.inv_date ?? null,
      });
    } else {
      console.log('[STANDARD] no previous PII; computing weighted openings from InventoryCount (OFR)…');
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: { id: item.itemVariantId } },
          select: ['sqmOfr', 'finalCostOfr'],
        });

      const totalOpenQty = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0),
        0,
      );
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvg = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

      console.log('[STANDARD] openings snapshot + resolved prevAvg (OFR):', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvg,
      });
    }

    // 3) This PO’s sqmOfr & unitPrice (finalOFR)
    const poQty = Number((item as any).sqm ?? 0);
    const poCost = Number((item as any).finalOFR ?? 0);
    console.log('[STANDARD] current PO contribution (OFR):', { poQty, poCost });

    // 4) New blended avg-OFR
    const totalQty = prevQty + poQty;
    const lhs = prevAvg * prevQty; // previous value bucket
    const rhs = poCost * poQty; // current row value bucket
    const newAvg = totalQty > 0 ? (lhs + rhs) / totalQty : poCost;
    console.log('[STANDARD] blend details (OFR):', {
      formula: 'newAvg = (prevAvg*prevQty + poCost*poQty) / (prevQty + poQty)',
      prevAvg,
      prevQty,
      poCost,
      poQty,
      lhs,
      rhs,
      totalQty,
      newAvg,
      guardWhenTotalQtyIsZero: totalQty === 0 ? '(used poCost)' : '(used blend)',
    });

    // 5) Persist STANDARD into PurchaseInvoiceItem & ItemVariant
    const piiUpdateRes = await this.itemRepo.update(item.id, {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,
    });
    console.log('✓ [STANDARD] PII update result (OFR):', {
      piiId: item.id,
      affected: piiUpdateRes?.affected ?? 'n/a',
      set: { previousQuantity: prevQty, previousAverageCost: prevAvg, averageCost: newAvg },
    });

    const varUpdateResStd = await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
    console.log('✓ [STANDARD] Variant update result (OFR):', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResStd?.affected ?? 'n/a',
      set: { averageCost: newAvg, lastCost: poCost },
    });

    // ───────── VM COST TRACK (VM chain) ─────────
    const qbPrevVm = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevVm.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[VM] prevQty SQL:', qbPrevVm.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[VM] prevQty Params:', qbPrevVm.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }
    const { sum: rawPrevVm } = await qbPrevVm.getRawOne();
    const prevQtyVM = Number(rawPrevVm) || 0;
    console.log('[VM] prevQtyVM result (VM chain):', { rawPrevVm, prevQtyVM });

    // Prev avg VM: from previous PII.averageCostVM; if none, 0
    let prevAvgVM: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost_vm != null) {
      prevAvgVM = Number(prevPIIRaw.avg_cost_vm);
      console.log('[VM] prevAvgVM from previous PII.averageCostVM:', {
        prevAvgVM,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInvId: prevPIIRaw.inv_id ?? null,
        prevInvDate: prevPIIRaw.inv_date ?? null,
      });
    } else {
      prevAvgVM = 0;
      console.log('[VM] no previous PII found → prevAvgVM = 0');
    }

    const poQtyVM = Number(item.sqm);
    const poCostVM = Number((item as any).finalCost);

    const totalQtyVM = prevQtyVM + poQtyVM;
    const lhsVM = prevAvgVM * prevQtyVM;
    const rhsVM = poCostVM * poQtyVM;
    const newAvgVM = totalQtyVM > 0 ? (lhsVM + rhsVM) / totalQtyVM : poCostVM;
    console.log('[VM] blend details (VM):', {
      formula: 'newAvgVM = (prevAvgVM*prevQtyVM + poCostVM*poQtyVM) / (prevQtyVM + poQtyVM)',
      prevAvgVM,
      prevQtyVM,
      poCostVM,
      poQtyVM,
      lhsVM,
      rhsVM,
      totalQtyVM,
      newAvgVM,
      guardWhenTotalQtyVMIsZero: totalQtyVM === 0 ? '(used poCostVM)' : '(used blend)',
    });

    const piiUpdateResVM = await this.itemRepo.update(item.id, {
      previousQuantityVM: prevQtyVM,
      previousAverageCostVM: prevAvgVM,
      averageCostVM: newAvgVM,
    });
    console.log('✓ [VM] PII update result (VM):', {
      piiId: item.id,
      affected: piiUpdateResVM?.affected ?? 'n/a',
      set: {
        previousQuantityVM: prevQtyVM,
        previousAverageCostVM: prevAvgVM,
        averageCostVM: newAvgVM,
      },
    });

    const varUpdateResVM = await this.variantRepo.update(item.itemVariantId, {
      averageCostVM: newAvgVM,
      lastCostVM: poCostVM,
    });
    console.log('✓ [VM] Variant update result (VM):', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResVM?.affected ?? 'n/a',
      set: { averageCostVM: newAvgVM, lastCostVM: poCostVM },
    });
  } // end per-PII loop (STANDARD/VM)

  /* ────────────────────────────────────────────────
     C-LEVEL (by description, current invoice) — OFR
     ──────────────────────────────────────────────── */
  console.log('\n📚 C-Level (by description) calculations start');
  for (const descId of descIds) {
    console.log(`\n[C] ► Description ${descId}`);

    // all variants under this description
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[C] variantIdsForDesc:', variantIdsForDesc);
    const dayStart = new Date(invDate);
dayStart.setHours(0, 0, 0, 0);


    // previous qty (OFR sum), up to & INCLUDING invDate; exclude current PO rows
    const qbPrevC = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(COALESCE(tx.sqmofr, 0))', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    try {
      // @ts-ignore
      console.log('[C] prevQtyC SQL:', qbPrevC.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[C] prevQtyC Params:', qbPrevC.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }
    const { sum: rawPrevC } = await qbPrevC.getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;
    console.log('[C] prevQtyC result (OFR):', { rawPrevC, prevQtyC });

    // previous avgC from last settled PII on/before invDate; else openings (OFR)
    let prevAvgC: number;
    const lastDescItem = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date <= :date', { date: invDate })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();

    if (lastDescItem && lastDescItem.averageCostC != null) {
      prevAvgC = Number(lastDescItem.averageCostC);
      console.log('[C] prevAvgC from last PII.averageCostC:', prevAvgC);
    } else {
      console.log('[C] no prior PII.averageCostC, compute from openings (OFR)…');
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqmOfr', 'finalCostOfr'],
        });

      const totalOpenQty = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0),
        0,
      );
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
      console.log('[C] openings snapshot (OFR):', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvgC,
      });
    }

    // group CURRENT PO rows that share this description — OFR chain
    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce(
      (s, it: any) => s + Number(it.sqm ?? 0),
      0,
    );
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it: any) =>
        s + Number(it.sqm ?? 0) * Number(it.finalCost ?? 0),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
    console.log('[C] current PO group snapshot (OFR):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x: any) => ({
        piiId: x.id,
        sqmOfr: Number(x.sqmOfr ?? 0),
        finalOFR: Number(x.finalOFR ?? 0),
      })),
      poQtyC,
      weightedCostSum,
      poCostC,
    });

    const totalQtyC = prevQtyC + poQtyC;
    const lhsC = prevAvgC * prevQtyC;
    const rhsC = poCostC * poQtyC;
    const newAvgC = totalQtyC > 0 ? (lhsC + rhsC) / totalQtyC : poCostC;
    console.log('[C] blend details (OFR):', {
      formula: 'newAvgC = (prevAvgC*prevQtyC + poCostC*poQtyC) / (prevQtyC + poQtyC)',
      prevAvgC,
      prevQtyC,
      poCostC,
      poQtyC,
      lhsC,
      rhsC,
      totalQtyC,
      newAvgC,
      guardWhenTotalQtyCIsZero: totalQtyC === 0 ? '(used poCostC)' : '(used blend)',
    });

    // apply SAME C-values to ALL PII rows in this description on THIS PO
    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
      });
      console.log('✓ [C] PII row updated with C-values (OFR):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: { previousQuantityC: prevQtyC, previousAverageCostC: prevAvgC, averageCostC: newAvgC },
      });
    }
  }

  /* ────────────────────────────────────────────────
     CVM-LEVEL (by description, current invoice) — VM
     ──────────────────────────────────────────────── */
  console.log('\n📚 CVM-Level (by description) calculations start');
  for (const descId of descIds) {
    console.log(`\n[CVM] ► Description ${descId}`);

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[CVM] variantIdsForDesc:', variantIdsForDesc);

    const qbPrevCVM = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );

    try {
      // @ts-ignore
      console.log('[CVM] prevQtyCVM SQL:', qbPrevCVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[CVM] prevQtyCVM Params:', qbPrevCVM.getParameters?.() ?? '(params not available)');
    } catch {
      /* noop */
    }

    const { sum: rawPrevCVM } = await qbPrevCVM.getRawOne();
    const prevQtyCVM = Number(rawPrevCVM) || 0;
    console.log('[CVM] prevQtyCVM result (VM):', { rawPrevCVM, prevQtyCVM });

    let prevAvgCVM: number;
    const lastDescItemCVM = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostCVM'])
      .getOne();

    if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
      prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
      console.log('[CVM] prevAvgCVM from last PII.averageCostCVM:', prevAvgCVM);
    } else {
      console.log('[CVM] no prior PII.averageCostCVM, compute from openings (VM)…');
      const openingsVM = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCost'],
        });

      const totalOpenQtyVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm ?? 0),
        0,
      );
      const weightedSumVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
        0,
      );
      prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
      console.log('[CVM] openings snapshot (VM):', {
        openingsCount: openingsVM.length,
        totalOpenQtyVM,
        weightedSumVM,
        prevAvgCVM,
      });
    }

    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyCVM = poItemsSameDesc.reduce(
      (s, it) => s + Number(it.sqm),
      0,
    );
    const weightedCostSumVM = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
      0,
    );
    const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

    console.log('[CVM] current PO group snapshot (VM):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x) => ({
        piiId: x.id,
        sqm: Number(x.sqm),
        finalCost: Number((x as any).finalCost),
      })),
      poQtyCVM,
      weightedCostSumVM,
      poCostCVM,
    });

    const totalQtyCVM = prevQtyCVM + poQtyCVM;
    const lhsCVM = prevAvgCVM * prevQtyCVM;
    const rhsCVM = poCostCVM * poQtyCVM;
    const newAvgCVM = totalQtyCVM > 0 ? (lhsCVM + rhsCVM) / totalQtyCVM : poCostCVM;
    console.log('[CVM] blend details (VM):', {
      formula: 'newAvgCVM = (prevAvgCVM*prevQtyCVM + poCostCVM*poQtyCVM) / (prevQtyCVM + poQtyCVM)',
      prevAvgCVM,
      prevQtyCVM,
      poCostCVM,
      poQtyCVM,
      lhsCVM,
      rhsCVM,
      totalQtyCVM,
      newAvgCVM,
      guardWhenTotalQtyCVMIsZero: totalQtyCVM === 0 ? '(used poCostCVM)' : '(used blend)',
    });

    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      });
      console.log('✓ [CVM] PII row updated with CVM-values (VM):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: {
          previousQuantityCVM: prevQtyCVM,
          previousAverageCostCVM: prevAvgCVM,
          averageCostCVM: newAvgCVM,
        },
      });
    }
  }

 /* ────────────────────────────────────────────────
     FINAL WRITE → UPDATE ItemNameDescription
     (NO recalculation — use already computed values)
   ──────────────────────────────────────────────── */

console.log('\n🗂 Writing final ItemNameDescription costs…');

for (const descId of descIds) {
  const poRows = itemsByDesc.get(descId) ?? [];

  if (!poRows.length) {
    console.warn(`⚠️ No PO rows found for descId: ${descId}, skipping…`);
    continue;
  }

  // Take any row of the same description — they all share SAME C & CVM values
  const ref = poRows[0];

// Reload one item from DB to get fresh updated values
const fresh = await this.itemRepo.findOne({ where: { id: ref.id } });

const finalWrite = {
  averageCostC: Number(fresh?.averageCostC ?? 0),
  averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
  lastCostC: Number((ref as any).finalOFR ?? 0),
  lastCostCVM: Number((ref as any).finalCost ?? 0),
};

  console.log(`📝 Updating Description ${descId} with:`, finalWrite);

  await this.descRepo.update(descId, finalWrite);

  console.log(`✓ Updated ItemNameDescription ${descId}`);
}

console.log('🧾 ItemNameDescription update (final) completed.');


  /* ────────────────────────────────────────────────
     FORWARD RECOMPUTE FOR LATER POs
     ──────────────────────────────────────────────── */
  const affectedVariantIds = Array.from(
    new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)),
  );
  const affectedDescIds = Array.from(descIds);

  if (affectedVariantIds.length || affectedDescIds.length) {
    console.log('🔁 Checking for later POs to recompute…', {
      affectedVariantIds,
      affectedDescIds,
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type = :typ', { typ: 'S' })
      .andWhere('inv.date > :cut', { cut: invDate })
      .andWhere(`(iv.id IN (:...varIds) OR iv.itemNameDescriptionId IN (:...descIds))`, {
        varIds: affectedVariantIds.length ? affectedVariantIds : [-1],
        descIds: affectedDescIds.length ? affectedDescIds : [-1],
      })
      .select('inv.id', 'id')
      .addSelect('inv.date', 'date')
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; date: Date }>();

    const laterIds = laterRaw.map((r) => r.id);
    console.log('🔁 Later PO IDs to recompute:', laterIds);

    const recomputeInvoice = async (targetId: number) => {
      const targetInv = await this.invoiceRepo.findOne({
        where: { id: targetId },
        relations: ['items', 'items.itemVariant'],
      });
      if (!targetInv) {
        console.warn('⚠️ Target invoice not found during forward recompute:', { targetId });
        return;
      }

      const cutoffDate = new Date(targetInv.date);
      const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
      const tHasCurrIds = tCurrPiiIds.length > 0;

      console.log(
        `\n🔁 Recomputing invoice ${targetInv.id} dated ${cutoffDate.toISOString().slice(0, 10)}`,
        { itemCount: targetInv.items?.length ?? 0, tHasCurrIds, tCurrPiiIds },
      );

      const tItemsByDesc = new Map<number, any[]>();
      const tDescIds = new Set<number>();

      // ───────── RECOMP: per-PII STANDARD/VM ─────────
      for (const item of targetInv.items) {
        const iv =
          item.itemVariant ??
          (await this.variantRepo.findOne({
            where: { id: item.itemVariantId },
          }));
        if (!iv) {
          console.warn('⚠️ Variant missing during recompute for PII:', item.id);
          continue;
        }
        const descId = iv.itemNameDescriptionId;

        if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
        tItemsByDesc.get(descId)!.push(item);
        tDescIds.add(descId);

        // STANDARD (OFR chain)
        const qbRPrev = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice < :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP STD] prev SQL:', qbRPrev.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP STD] prev Params:', qbRPrev.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */
        }
        const { sum: rawPrev } = await qbRPrev.getRawOne();
        const prevQty = Number(rawPrev) || 0;

        let prevAvg = iv.averageCost ?? 0; // baseline from current variant

        const poQty = Number((item as any).sqm ?? 0);
        const poCost = Number((item as any).finalOFR ?? 0);
        const totalQty = prevQty + poQty;
        const newAvg =
          totalQty > 0 ? (prevAvg * prevQty + poCost * poQty) / totalQty : poCost;
        console.log('[RECOMP STD] details (OFR):', {
          piiId: item.id,
          itemVariantId: item.itemVariantId,
          prevQty,
          prevAvg,
          poQty,
          poCost,
          totalQty,
          newAvg,
        });

        await this.itemRepo.update(item.id, {
          previousQuantity: prevQty,
          previousAverageCost: prevAvg,
          averageCost: newAvg,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCost: newAvg,
          lastCost: poCost,
        });

        // VM
        const qbRPrevVm = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP VM] prev SQL:', qbRPrevVm.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP VM] prev Params:', qbRPrevVm.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */
        }
        const { sum: rawPrevVm } = await qbRPrevVm.getRawOne();
        const prevQtyVM = Number(rawPrevVm) || 0;

        let prevAvgVM = iv.averageCostVM ?? 0;
        const poQtyVM = Number(item.sqm);
        const poCostVM = Number((item as any).finalCost);
        const totalQtyVM = prevQtyVM + poQtyVM;
        const newAvgVM =
          totalQtyVM > 0
            ? (prevAvgVM * prevQtyVM + poCostVM * poQtyVM) / totalQtyVM
            : poCostVM;
        console.log('[RECOMP VM] details (VM):', {
          piiId: item.id,
          itemVariantId: item.itemVariantId,
          prevQtyVM,
          prevAvgVM,
          poQtyVM,
          poCostVM,
          totalQtyVM,
          newAvgVM,
        });

        await this.itemRepo.update(item.id, {
          previousQuantityVM: prevQtyVM,
          previousAverageCostVM: prevAvgVM,
          averageCostVM: newAvgVM,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCostVM: newAvgVM,
          lastCostVM: poCostVM,
        });
      } // end per-PII in target

      // ───────── RECOMP C-LEVEL (OFR) ─────────
      console.log('\n[RECOMP C] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const qbRPrevC = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(COALESCE(tx.sqmofr, 0))', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP C] prevQtyC SQL:', qbRPrevC.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP C] prevQtyC Params:', qbRPrevC.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */
        }
        const { sum: rawPrevC } = await qbRPrevC.getRawOne();
        const prevQtyC = Number(rawPrevC) || 0;

        let prevAvgC: number;
        const lastDescItem = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
          .andWhere('inv.date <= :date', { date: cutoffDate })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostC'])
          .getOne();

        if (lastDescItem && lastDescItem.averageCostC != null) {
          prevAvgC = Number(lastDescItem.averageCostC);
        } else {
          const openings = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqmOfr', 'finalCostOfr'],
            });
          const totalOpenQty = openings.reduce(
            (s, o) => s + Number(o.sqmOfr ?? 0),
            0,
          );
          const weightedSum = openings.reduce(
            (s, o) =>
              s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
            0,
          );
          prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyC = poItemsSameDesc.reduce(
          (s, it: any) => s + Number(it.sqm ?? 0),
          0,
        );
        const weightedCostSum = poItemsSameDesc.reduce(
          (s, it: any) =>
            s + Number(it.sqm ?? 0) * Number(it.finalOFR ?? 0),
          0,
        );
        const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
        const totalQtyC = prevQtyC + poQtyC;
        const newAvgC =
          totalQtyC > 0
            ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC
            : poCostC;
        console.log('[RECOMP C] details (OFR):', {
          descId,
          prevQtyC,
          prevAvgC,
          poQtyC,
          weightedCostSum,
          poCostC,
          totalQtyC,
          newAvgC,
        });

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityC: prevQtyC,
            previousAverageCostC: prevAvgC,
            averageCostC: newAvgC,
          });
        }
      }

      // ───────── RECOMP CVM-LEVEL (VM) ─────────
      console.log('\n[RECOMP CVM] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const qbRPrevCVM = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );

        try {
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM SQL:', qbRPrevCVM.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM Params:', qbRPrevCVM.getParameters?.() ?? '(params not available)');
        } catch {
          /* noop */ }

        const { sum: rawPrevCVM } = await qbRPrevCVM.getRawOne();
        const prevQtyCVM = Number(rawPrevCVM) || 0;

        let prevAvgCVM = 0;
        const lastDescItemCVM = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
          .andWhere('inv.date <= :date', { date: cutoffDate })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostCVM'])
          .getOne();

        if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
          prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
        } else {
          const openingsVM = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqm', 'finalCost'],
            });

          const totalOpenQtyVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm ?? 0),
            0,
          );
          const weightedSumVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
            0,
          );
          prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyCVM = poItemsSameDesc.reduce(
          (s, it) => s + Number(it.sqm),
          0,
        );
        const weightedCostSumVM = poItemsSameDesc.reduce(
          (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
          0,
        );
        const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

        const totalQtyCVM = prevQtyCVM + poQtyCVM;
        const newAvgCVM =
          totalQtyCVM > 0
            ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalQtyCVM
            : poCostCVM;

        console.log('[RECOMP CVM] details (VM):', {
          descId,
          prevQtyCVM,
          prevAvgCVM,
          poQtyCVM,
          weightedCostSumVM,
          poCostCVM,
          totalQtyCVM,
          newAvgCVM,
        });

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityCVM: prevQtyCVM,
            previousAverageCostCVM: prevAvgCVM,
            averageCostCVM: newAvgCVM,
          });
        }
      }

    // ───────── RECOMP ItemNameDescription UPDATE (NO recalculation) ─────────
console.log('\n[RECOMP DESC] Updating ItemNameDescription based on final recomputed rows…');

for (const descId of tDescIds) {
  const rows = tItemsByDesc.get(descId) ?? [];
  if (!rows.length) {
    console.warn(`⚠️ No matching rows for descId ${descId} during recompute.`);
    continue;
  }

  // Any row of the same description — they all share same cost after recompute
  const ref = rows[0];

  // 🔹 IMPORTANT: reload fresh row from DB to get the recomputed averages
  const fresh = await this.itemRepo.findOne({
    where: { id: ref.id },
  });

  const updateValues = {
    averageCostC: Number(fresh?.averageCostC ?? 0),
    averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
    lastCostC: Number((ref as any).finalOFR ?? 0),
    lastCostCVM: Number((ref as any).finalCost ?? 0),
  };

  console.log(`[RECOMP DESC] Writing to Description ${descId}:`, updateValues);

  await this.descRepo.update(descId, updateValues);

  console.log(`✓ Updated ItemNameDescription ${descId} (recompute apply)`);
}


    };

    for (const id of laterIds) {
      await recomputeInvoice(id);
    }
    console.log('🔁 Forward recompute complete.');
  }

  console.log('🧾 PO Cost Calc — End', { invoiceId: savedInvoice.id });
}

// 🔎 END: Cost-calculation & logging block

// 🔎 BEGIN: Cost-calculation & logging block (prevAvg now pulled from last prior PO; VM fallback=0; STANDARD fallback=weighted openings)
// 🔎 BEGIN: G-invoice cost-calculation & logging block (type-based history: G/S/SR; OFR-only; VM fields = NULL)
if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'G') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous" lookups

  console.log('🧾 [G] PO Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceType: savedInvoice.type,
    invoiceDateISO: invDate.toISOString(),
    cutoffForPreviousISO: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
    priorTypes: ['G', 'S', 'SR'],
  });

  const itemsByDesc = new Map<number, any[]>();

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 [G] Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Collect description IDs
  const descIds = new Set<number>();

  for (const item of savedInvoice.items) {
    // ───────── STANDARD (OFR) COST TRACK — G invoices use OFR only ─────────
    const variantt = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId'],
    });
    if (!variantt) {
      console.error(`❌ [G] Variant ${item.itemVariantId} not found`);
      continue;
    }

    const vid = variantt.id;
    const descId = variantt.itemNameDescriptionId;

    // collect this PII under its description
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[STANDARD:G] ► Processing PII ${item.id} (variantId=${vid}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log('[STANDARD:G] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqm: Number(item.sqm),
      finalOFR: Number((item as any).finalOFR),
      finalCost: Number((item as any).finalCost),
    });

    // 0) Determine PREVIOUS AVERAGE (NEW: type-based search G/S/SR; exclude same day)
    const priorTypes = ['G', 'S', 'SR'] as const;
    const qbPrevPII = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: priorTypes })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCost AS avg_cost',
        'pii.averageCostC AS avg_cost_c',
        'inv.id AS inv_id',
        'inv.date AS inv_date',
        'inv.type AS inv_type',
      ]);

    try {
      // @ts-ignore
      console.log('[PREV PII:G] SQL:', qbPrevPII.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[PREV PII:G] Params:', qbPrevPII.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const prevPIIRaw = await qbPrevPII.getRawOne<{
      pii_id?: number;
      avg_cost?: string | number | null;
      avg_cost_c?: string | number | null;
      inv_id?: number;
      inv_date?: Date;
      inv_type?: string;
    }>();
    console.log('[PREV PII:G] raw result:', prevPIIRaw ?? null);

    // 1) Sum prior quantity — OFR ONLY, inclusive cutoff (<= invDate), exclude current PII
    const qbPrevQty = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevQty.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[STANDARD:G] prevQty (OFR) SQL:', qbPrevQty.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[STANDARD:G] prevQty (OFR) Params:', qbPrevQty.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevOfr } = await qbPrevQty.getRawOne();
    const prevQty = Number(rawPrevOfr) || 0;
    console.log('[STANDARD:G] prevQty (OFR) result:', { rawPrevOfr, prevQty });

    // 2) Prev avg-OFR — from previous PII.averageCost across types G/S/SR; else openings (OFR)
    let prevAvg: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost != null) {
      prevAvg = Number(prevPIIRaw.avg_cost);
      console.log('[STANDARD:G] prevAvg from previous PII.averageCost:', {
        prevAvg,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInv: {
          id: prevPIIRaw.inv_id ?? null,
          type: prevPIIRaw.inv_type ?? null,
          date: prevPIIRaw.inv_date ?? null,
        },
      });
    } else {
      console.log('[STANDARD:G] no previous PII; computing weighted openings from InventoryCount (OFR)…');
      const openings = await this.invTransRepo.manager.getRepository(InventoryCount).find({
        where: { itemVariant: { id: item.itemVariantId } },
        select: ['sqmOfr', 'finalCostOfr'],
      });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr) * Number(o.finalCostOfr),
        0,
      );
      prevAvg = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

      console.log('[STANDARD:G] openings snapshot + resolved prevAvg:', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvg,
      });
    }

    // 3) Current PO — OFR inputs only
    const poQty = Number(item.sqm);
    const poCost = Number((item as any).finalOFR);
    console.log('[STANDARD:G] current PO contribution (OFR):', { poQty, poCost });

    // 4) Blend (OFR)
    const totalQty = prevQty + poQty;
    const lhs = prevAvg * prevQty; // value of stock before
    const rhs = poCost * poQty;    // value of current receipt
    const newAvg = totalQty > 0 ? (lhs + rhs) / totalQty : poCost;
    console.log('[STANDARD:G] blend details (OFR):', {
      formula: 'newAvg = (prevAvg*prevQty + poCost*poQty) / (prevQty + poQty)',
      prevAvg,
      prevQty,
      poCost,
      poQty,
      lhs,
      rhs,
      totalQty,
      newAvg,
      guardWhenTotalQtyIsZero: totalQty === 0 ? '(used poCost)' : '(used blend)',
    });

    // 5) Persist — STANDARD fields + explicitly NULL out VM/CVM "previous" fields
    const piiUpdatePayload: any = {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,

      // VM track is NOT used for G → set NULLs
      previousQuantityVM: null,
      previousAverageCostVM: null,

      // If your schema has CVM "previous" fields, we also null them out:
      previousQuantityCVM: null,
      previousAverageCostCVM: null,
    };

    const piiUpdateRes = await this.itemRepo.update(item.id, piiUpdatePayload);
    console.log('✓ [STANDARD:G] PII update result:', {
      piiId: item.id,
      affected: piiUpdateRes?.affected ?? 'n/a',
      set: piiUpdatePayload,
    });

    // Update variant — OFR stats only; do NOT touch VM stats
    const varUpdateResStd = await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
    console.log('✓ [STANDARD:G] Variant update result (OFR only):', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResStd?.affected ?? 'n/a',
      set: { averageCost: newAvg, lastCost: poCost },
      note: 'VM stats untouched for G invoices',
    });

    // (No VM track for G)
    console.log('ⓘ [G] VM calculation skipped. VM-related previous fields saved as NULL.');
  } // end per-PII loop

  // ───────── C-LEVEL (description) FOR CURRENT G INVOICE — ONCE PER DESCRIPTION ─────────
  console.log('\n📚 [G] C-Level (by description) calculations start');
  for (const descId of descIds) {
    console.log(`\n[C:G] ► Description ${descId}`);

    // all variants under this description
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[C:G] variantIdsForDesc:', variantIdsForDesc);

    // previous qty (OFR ONLY), up to & INCLUDING invDate; exclude current PO rows
    const qbPrevC = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    try {
      // @ts-ignore
      console.log('[C:G] prevQtyC (OFR) SQL:', qbPrevC.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[C:G] prevQtyC (OFR) Params:', qbPrevC.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }
    const { sum: rawPrevC } = await qbPrevC.getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;
    console.log('[C:G] prevQtyC (OFR) result:', { rawPrevC, prevQtyC });



    console.log(`\n🔍 [C-DEBUG] Resolving previous average cost C for descId=${descId}`);

const lastDescItemDebugQB = this.itemRepo
  .createQueryBuilder('pii')
  .innerJoin('pii.invoice', 'inv')
  .innerJoin('pii.itemVariant', 'iv')
  .where('inv.status = :status', { status: 'Recieved' })
  .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
  .andWhere('inv.date < :date', { date: dayStart })
  .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
  .andWhere('iv.itemNameDescriptionId = :descId', { descId })
  .orderBy('inv.date', 'DESC')
  .addOrderBy('pii.id', 'DESC')
  .select([
    'pii.id AS pii_id',
    'pii.averageCostC AS avg_cost_c',
    'pii.averageCost AS avg_cost_ofr',
    'pii.finalCost AS lastFinalCost',
    'inv.id AS inv_id',
    'inv.type AS inv_type',
    'inv.date AS inv_date'
  ]);

try {
  console.log('🧠 [C-DEBUG] SQL used to search for historical C:', lastDescItemDebugQB.getSql());
  console.log('🧠 [C-DEBUG] Params:', lastDescItemDebugQB.getParameters());
} catch {}

const historyRows = await lastDescItemDebugQB.getRawMany();
console.log(`📄 [C-DEBUG] Found ${historyRows.length} candidate rows:`);

historyRows.forEach((row, i) =>
  console.log(`   ➤ Row #${i+1}:`, {
    piiId: row.pii_id,
    invId: row.inv_id,
    invoiceType: row.inv_type,
    invoiceDate: row.inv_date,
    averageCostC: row.avg_cost_c,
    fallback_OFR: row.avg_cost_ofr,
    fallback_lastCost: row.lastFinalCost
  })
);

    // 🔽 Decision
let prevAvgC: number;

if (historyRows.length > 0) {
  const firstValid = historyRows.find(r => r.avg_cost_c !== null);
  if (firstValid) {
    prevAvgC = Number(firstValid.avg_cost_c);
    console.log(`🎯 [C-DEBUG] PREVIOUS AVERAGE FOUND → using averageCostC=${prevAvgC} from PII=${firstValid.pii_id}`);
  } else {
    console.log(`⚠️ [C-DEBUG] Historical rows exist, but NONE have averageCostC recorded.`);
    console.log(`➡️ Fallback: Will compute from openings or finalOFR.`);

    prevAvgC = null as any; // force fallback
  }
} else {
  console.log(`❌ [C-DEBUG] No historical invoices match C-level rules.`);
  prevAvgC = null as any; // trigger fallback
}

// ─────────────────────────────
// 💾 OPENING STOCK FALLBACK
// ─────────────────────────────
if (prevAvgC === null) {
  console.log(`🔁 [C-DEBUG] Computing fallback from InventoryCount (openings)…`);
  const openings = await this.invTransRepo.manager
    .getRepository(InventoryCount)
    .find({
      where: { itemVariant: In(variantIdsForDesc) },
      select: ['sqmOfr', 'finalCostOfr'],
    });

  console.log(`📦 [C-DEBUG] Opening rows (${openings.length}):`);

  openings.forEach((op, i) =>
    console.log(`   ➤ Opening #${i+1}: sqmOfr=${op.sqmOfr}, cost=${op.finalCostOfr}`)
  );

  const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
  const weightedSum = openings.reduce(
    (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
    0,
  );

  prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

  console.log(`📊 [C-DEBUG] Result of fallback calculation:`);
  console.log({
    totalOpenQty,
    weightedSum,
    computedAvg: prevAvgC
  });

  if (prevAvgC === 0) {
    console.log(`⚠️ [C-DEBUG] Fallback avg=0 → meaning: no openings + no history → this invoice is first cost reference!`);
  }
}

console.log(`✅ [C-DEBUG] FINAL selected prevAvgC=${prevAvgC}`);

    // group CURRENT PO rows that share this description (OFR)
    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalOFR) * Number(it.sqm),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
    console.log('[C:G] current PO group snapshot (OFR):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x) => ({
        piiId: x.id,
        sqm: Number(x.sqm),
        finalOFR: Number((x as any).finalOFR),
      })),
      poQtyC,
      weightedCostSum,
      poCostC,
    });

    const totalQtyC = prevQtyC + poQtyC;
    const lhsC = prevAvgC * prevQtyC;
    const rhsC = poCostC * poQtyC;
    const newAvgC = totalQtyC > 0 ? (lhsC + rhsC) / totalQtyC : poCostC;
    console.log('[C:G] blend details (OFR):', {
      formula: 'newAvgC = (prevAvgC*prevQtyC + poCostC*poQtyC) / (prevQtyC + poQtyC)',
      prevAvgC,
      prevQtyC,
      poCostC,
      poQtyC,
      lhsC,
      rhsC,
      totalQtyC,
      newAvgC,
      guardWhenTotalQtyCIsZero: totalQtyC === 0 ? '(used poCostC)' : '(used blend)',
    });

    // apply SAME C-values to ALL PII rows in this description on THIS PO
    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,

        // If your schema carries CVM "previous" fields and you wish them NULL on G, you can also set:
        previousQuantityCVM: null,
        previousAverageCostCVM: null,
      });
      console.log('✓ [C:G] PII row updated with C-values:', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: { previousQuantityC: prevQtyC, previousAverageCostC: prevAvgC, averageCostC: newAvgC },
      });
    }
  }
  // ───────── UPDATE ItemNameDescription TABLE (OFR-only) ─────────
  console.log('\n🗂 [G] Updating ItemNameDescription table…');
  for (const descId of descIds) {
    console.log(`\n— [G] Updating ItemNameDescription ${descId} —`);

    // 🔹 We ALREADY computed C-level averages above per description
    //    and wrote them into the PII rows.
    //    Here, we just mirror those values into ItemNameDescription.

    // All current PO rows for this description on THIS invoice
    const poItemsForDesc = itemsByDesc.get(descId) ?? [];
    if (!poItemsForDesc.length) {
      console.log('[C->Desc:G] No current PII rows for this description; skipping.');
      continue;
    }

    // Any row of this description on this invoice has the same averageCostC
    // (you set it in the previous C-level loop). We'll read from the first.
    const samplePii = poItemsForDesc[0] as any;

    const averageCostC = Number(samplePii.averageCostC ?? 0);

    // lastCostC = finalOFR of the last row of this description in this PO
    const lastRow = poItemsForDesc[poItemsForDesc.length - 1] as any;
    const lastCostC = Number(lastRow?.finalOFR ?? 0);

    console.log('[C->Desc:G] Mirroring C-values from PII into ItemNameDescription:', {
      descId,
      samplePiiId: samplePii.id,
      averageCostC,
      lastCostC,
      piiIds: poItemsForDesc.map((x: any) => x.id),
    });

    const descUpdateRes = await this.descRepo.update(descId, {
      averageCostC,
      lastCostC,
    });

    console.log('✓ [C->Desc:G] ItemNameDescription update (NO recalculation):', {
      descId,
      affected: descUpdateRes?.affected ?? 'n/a',
      set: { averageCostC, lastCostC },
    });
  }


  // ─────────────────────────────
  // ⚙️ Forward recompute for back-dated inserts
  //   - If a later invoice is type G, use SAME prior rule (types IN G/S/SR, cutoff = that invoice day start)
  //   - Keep VM NULL for G
  // ─────────────────────────────
  const affectedVariantIds = Array.from(
    new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)),
  );
  const affectedDescIds = Array.from(descIds);

  if (affectedVariantIds.length || affectedDescIds.length) {
    console.log('🔁 [G] Checking for later POs to recompute…', {
      affectedVariantIds,
      affectedDescIds,
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] }) // recompute later invoices of these types (safe superset)
      .andWhere('inv.date > :cut', { cut: dayStart })
      .andWhere(`(iv.id IN (:...varIds) OR iv.itemNameDescriptionId IN (:...descIds))`, {
        varIds: affectedVariantIds.length ? affectedVariantIds : [-1],
        descIds: affectedDescIds.length ? affectedDescIds : [-1],
      })
      .select('inv.id', 'id')
      .addSelect('inv.type', 'type')
      .addSelect('inv.date', 'date')
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; type: 'G' | 'S' | 'SR'; date: Date }>();
const laterIds = laterRaw.map((r) => r.id);
console.log('🔁 [G] Later PO IDs to recompute:', laterIds, { meta: laterRaw });

/**
 * Recompute for a later G invoice (OFR-only; VM previous fields kept NULL)
 * — This is your existing G recompute body, kept intact.
 */
const recomputeInvoiceG = async (targetId: number) => {
  const targetInv = await this.invoiceRepo.findOne({
    where: { id: targetId },
    relations: ['items', 'items.itemVariant'],
  });
  if (!targetInv) {
    console.warn('⚠️ Target invoice not found during forward recompute (G):', { targetId });
    return;
  }

  const cutoffDate = new Date(targetInv.date);
  const cutoffDayStart = new Date(cutoffDate);
  cutoffDayStart.setHours(0, 0, 0, 0);

  const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
  console.log(
    `\n🔁 [RECOMP:G] Invoice ${targetInv.id} dated ${cutoffDate.toISOString().slice(0, 10)} (OFR-only)`,
    { itemCount: targetInv.items?.length ?? 0, tCurrPiiIds },
  );

  const tItemsByDesc = new Map<number, any[]>();
  const tDescIds = new Set<number>();

  for (const item of targetInv.items) {
    const iv =
      item.itemVariant ??
      (await this.variantRepo.findOne({
        where: { id: item.itemVariantId },
      }));
    if (!iv) {
      console.warn('⚠️ [RECOMP:G] Variant missing for PII:', item.id);
      continue;
    }
    const descId = iv.itemNameDescriptionId;

    if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
    tItemsByDesc.get(descId)!.push(item);
    tDescIds.add(descId);

    // prev qty (OFR)
    const { sum: rawPrev } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
        { currIds: tCurrPiiIds },
      )
      .getRawOne();
    const prevQty = Number(rawPrev) || 0;

    // prev avg from last prior PII among (G,S,SR) before that day’s start
    let prevAvg = 0;
    const prevPII = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :cutoff', { cutoff: cutoffDayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCost AS avg_cost', 'pii.id AS pii_id', 'inv.id AS inv_id', 'inv.type AS inv_type', 'inv.date AS inv_date'])
      .getRawOne<{ avg_cost?: number | string | null; pii_id?: number; inv_id?: number; inv_type?: string; inv_date?: Date }>();

    if (prevPII?.avg_cost != null) {
      prevAvg = Number(prevPII.avg_cost);
      console.log('[RECOMP:G] prevAvg from prior PII.averageCost (G/S/SR):', {
        itemId: item.id,
        variantId: item.itemVariantId,
        prevAvg,
        prevPiiMeta: { piiId: prevPII.pii_id, invId: prevPII.inv_id, invType: prevPII.inv_type, invDate: prevPII.inv_date },
      });
    } else {
      // openings fallback
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({ where: { itemVariant: { id: iv.id } }, select: ['sqm', 'finalCostOfr'] });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce((s, o) => s + Number(o.sqm) * Number(o.finalCostOfr), 0);
      prevAvg = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
      console.log('[RECOMP:G] openings fallback → prevAvg:', { itemId: item.id, variantId: item.itemVariantId, totalOpenQty, weightedSum, prevAvg });
    }

    // blend (OFR)
    const poQty = Number(item.sqm);
    const poCost = Number((item as any).finalOFR);
    const totalQty = prevQty + poQty;
    const newAvg = totalQty > 0 ? (prevAvg * prevQty + poCost * poQty) / totalQty : poCost;

    await this.itemRepo.update(item.id, {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,
      // ensure VM previous remain NULL for G invoices
      previousQuantityVM: null,
      previousAverageCostVM: null,
      previousQuantityCVM: null,
      previousAverageCostCVM: null,
    });
    await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
  }

  // C-level (OFR-only)
  console.log('\n[RECOMP C:G] start for invoice:', targetInv.id);
  for (const descId of tDescIds) {
    const variantIdsForDesc = (
      await this.variantRepo.find({ where: { itemNameDescriptionId: descId }, select: ['id'] })
    ).map((v) => v.id);

    const { sum: rawPrevC } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(COALESCE(tx.sqmofr, tx.sqm, 0))', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere('(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))', {
        currIds: tCurrPiiIds,
      })
      .getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;

    // prevAvgC from last prior PII among (G,S,SR) before that day’s start
    let prevAvgC = 0;
    const lastDescItem = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date <= :date', { date: cutoffDate })
      .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();
    if (lastDescItem && (lastDescItem as any).averageCostC != null) {
      prevAvgC = Number((lastDescItem as any).averageCostC);
    } else {
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({ where: { itemVariant: In(variantIdsForDesc) }, select: ['sqm', 'finalCostOfr'] });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce((s, o) => s + Number(o.sqm) * Number(o.finalCostOfr), 0);
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
    }

    const poItemsSameDesc = (targetInv.items ?? []).filter((it) => {
      const v = it.itemVariant ?? null;
      return v && v.itemNameDescriptionId === descId;
    });
    const poQtyC = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalOFR) * Number(it.sqm),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;

    const totalQtyC = prevQtyC + poQtyC;
    const newAvgC = totalQtyC > 0 ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC : poCostC;

    for (const it of poItemsSameDesc) {
      await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
        // keep any CVM previous fields NULL if your schema has them
        previousQuantityCVM: null,
        previousAverageCostCVM: null,
      });
         // 🔹 NEW: Mirror to ItemNameDescription — NO extra calculations
    if (poItemsSameDesc.length) {
      const lastRow = poItemsSameDesc[poItemsSameDesc.length - 1] as any;
      const lastCostC = Number(lastRow?.finalOFR ?? 0);

      console.log('[RECOMP C:G -> Desc] Mirroring C-values into ItemNameDescription:', {
        descId,
        averageCostC: newAvgC,
        lastCostC,
      });

      await this.descRepo.update(descId, {
        averageCostC: newAvgC,
        lastCostC,
      });
    }
    }
  }
};

/**
 * NEW: Recompute for a later S or SR invoice — Standard + C ONLY (skip VM)
 * Reason: a back-dated G changes only the OFR chain. VM chain (sqm/finalCost) is unaffected by G,
 * so we deliberately do not touch VM fields here.
 */
const recomputeInvoiceSOrSR_StandardOnly = async (targetId: number) => {
  const targetInv = await this.invoiceRepo.findOne({
    where: { id: targetId },
    relations: ['items', 'items.itemVariant'],
  });
  if (!targetInv) {
    console.warn('⚠️ Target invoice not found during forward recompute (S/SR std-only):', { targetId });
    return;
  }

  const cutoffDate = new Date(targetInv.date);
  const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
  console.log(
    `\n🔁 [RECOMP S/SR from G] Invoice ${targetInv.id} dated ${cutoffDate.toISOString().slice(0, 10)} — Standard + C ONLY (skip VM)`,
    { type: targetInv.type, itemCount: targetInv.items?.length ?? 0, tCurrPiiIds },
  );

  // Group for C-level
  const tItemsByDesc = new Map<number, any[]>();
  const tDescIds = new Set<number>();

  // STANDARD only per-PII
  for (const item of targetInv.items) {
    const iv =
      item.itemVariant ??
      (await this.variantRepo.findOne({
        where: { id: item.itemVariantId },
        select: ['id', 'itemNameDescriptionId', 'averageCost'],
      }));
    if (!iv) continue;

    const descId = iv.itemNameDescriptionId;
    if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
    tItemsByDesc.get(descId)!.push(item);
    tDescIds.add(descId);

    // prev qty STD = SUM(sqmofr) up to cutoff, excluding own rows
    const { sum: rawPrevStd } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere('(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))', {
        currIds: tCurrPiiIds,
      })
      .getRawOne();
    const prevQty = Number(rawPrevStd) || 0;
    const prevAvg = iv.averageCost ?? 0;

    const poQty = Number(item.sqm);
    const poCost = Number((item as any).finalOFR);
    const totalQty = prevQty + poQty;
    const newAvg = totalQty > 0 ? (prevAvg * prevQty + poCost * poQty) / totalQty : poCost;

    await this.itemRepo.update(item.id, {
      previousQuantity: prevQty,
      previousAverageCost: prevAvg,
      averageCost: newAvg,
      // DO NOT touch any VM fields here
    });
    await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvg,
      lastCost: poCost,
    });
  }

  // C-level (same as your S logic; using OFR chain)
  console.log('[RECOMP C from G] start for invoice:', targetInv.id);
  for (const descId of tDescIds) {
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);

    const { sum: rawPrevC } = await this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(COALESCE(tx.sqmofr, tx.sqm, 0))', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
      .andWhere('(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))', {
        currIds: tCurrPiiIds,
      })
      .getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;

    // previous avgC: keep your S-only baseline (or widen to S/SR if you want)
    let prevAvgC = 0;
    const lastDescItem = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G','S','SR'] })
      .andWhere('inv.date <= :date', { date: cutoffDate })
      .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();
    if (lastDescItem && (lastDescItem as any).averageCostC != null) {
      prevAvgC = Number((lastDescItem as any).averageCostC);
    } else {
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCostOfr'],
        });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce((s, o) => s + Number(o.sqm) * Number(o.finalCostOfr), 0);
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
    }

    const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalOFR) * Number(it.sqm),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
    const totalQtyC = prevQtyC + poQtyC;
    const newAvgC = totalQtyC > 0 ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC : poCostC;

    for (const it of poItemsSameDesc) {
      await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
        // DO NOT touch any VM fields here
      });
    }
  }
};

// --- Dispatch based on later invoice type
for (const r of laterRaw) {
  
  if (r.type === 'G') {
    await recomputeInvoiceG(r.id);
  } else if (r.type === 'S' || r.type === 'SR') {
    await recomputeInvoiceSOrSR_StandardOnly(r.id); // ⬅️ Standard + C only, skip VM
  }
}
console.log('🔁 [G] Forward recompute complete.');
  }

  console.log('🧾 [G] PO Cost Calc — End', { invoiceId: savedInvoice.id });
}
// 🔎 END: G-invoice block



// 🔎 BEGIN: SR-invoice block (hybrid: G for OFR/C, S for VM/CVM)
if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'SR') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous" lookups

  console.log('🧾 [SR] PO Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceType: savedInvoice.type,
    invoiceDateISO: invDate.toISOString(),
    cutoffForPreviousISO: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
    priorTypesForOFR: ['G', 'S', 'SR'],
  });

  const itemsByDesc = new Map<number, any[]>();

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 [SR] Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Collect description IDs
  const descIds = new Set<number>();

  /* ────────────────────────────────────────────────
     PER-PII LOOP: 
       - STANDARD/OFR & C → treat as G
       - VM & CVM → treat as S
     ──────────────────────────────────────────────── */
  for (const item of savedInvoice.items ?? []) {
    const variantt = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId', 'averageCost', 'averageCostVM'],
    });
    if (!variantt) {
      console.error(`❌ [SR] Variant ${item.itemVariantId} not found`);
      continue;
    }

    const vid = variantt.id;
    const descId = variantt.itemNameDescriptionId;

    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[STANDARD:SR] ► Processing PII ${item.id} (variantId=${vid}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log('[STANDARD:SR] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqmVM: Number(item.sqm),
      finalOFR: Number((item as any).finalOFR),
      finalCost: Number((item as any).finalCost),
    });

    /* -----------------------------------
       0) PREVIOUS AVERAGE (OFR) — G-style
       ----------------------------------- */
    const priorTypes = ['G', 'S', 'SR'] as const;
    const qbPrevPII = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: priorTypes })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCost AS avg_cost',
        'pii.averageCostVM AS avg_cost_vm',
        'pii.averageCostC AS avg_cost_c',
        'pii.averageCostCVM AS avg_cost_cvm',
        'inv.id AS inv_id',
        'inv.date AS inv_date',
        'inv.type AS inv_type',
      ]);

    try {
      // @ts-ignore
      console.log('[PREV PII:SR] SQL:', qbPrevPII.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[PREV PII:SR] Params:', qbPrevPII.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const prevPIIRaw = await qbPrevPII.getRawOne<{
      pii_id?: number;
      avg_cost?: string | number | null;
      avg_cost_vm?: string | number | null;
      avg_cost_c?: string | number | null;
      avg_cost_cvm?: string | number | null;
      inv_id?: number;
      inv_date?: Date;
      inv_type?: string;
    }>();
    console.log('[PREV PII:SR] raw result:', prevPIIRaw ?? null);

    /* -----------------------------------
       1) PREVIOUS QTY (OFR) from tx.sqmofr
       ----------------------------------- */
    const qbPrevQtyOFR = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevQtyOFR.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[STANDARD:SR] prevQty (OFR) SQL:', qbPrevQtyOFR.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[STANDARD:SR] prevQty (OFR) Params:', qbPrevQtyOFR.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    let prevQtyOFR = 0;
    const { sum: rawPrevOfr } = await qbPrevQtyOFR.getRawOne();
    prevQtyOFR = Number(rawPrevOfr) || 0;
    console.log('[STANDARD:SR] prevQty (OFR) result:', { rawPrevOfr, prevQtyOFR });

    /* -----------------------------------
       2) PREVIOUS AVG (OFR) — from prior PII or openings
       ----------------------------------- */
    let prevAvgOFR: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost != null) {
      prevAvgOFR = Number(prevPIIRaw.avg_cost);
      console.log('[STANDARD:SR] prevAvgOFR from previous PII.averageCost:', {
        prevAvgOFR,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInv: {
          id: prevPIIRaw.inv_id ?? null,
          type: prevPIIRaw.inv_type ?? null,
          date: prevPIIRaw.inv_date ?? null,
        },
      });
    } else {
      console.log('[STANDARD:SR] no previous PII; computing weighted openings from InventoryCount (OFR)…');
      const openings = await this.invTransRepo.manager.getRepository(InventoryCount).find({
        where: { itemVariant: { id: item.itemVariantId } },
        select: ['sqmOfr', 'finalCostOfr'],
      });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvgOFR = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;

      console.log('[STANDARD:SR] openings snapshot + resolved prevAvgOFR:', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvgOFR,
      });
    }

    /* -----------------------------------
       3) CURRENT PO CONTRIBUTION (OFR side)
       ----------------------------------- */
    const poQtyOFR = Number(item.sqm); // SR: the sqm is used as OFR quantity (similar to G)
    const poCostOFR = Number((item as any).finalOFR);
    console.log('[STANDARD:SR] current PO contribution (OFR):', { poQtyOFR, poCostOFR });

    const totalQtyOFR = prevQtyOFR + poQtyOFR;
    const lhsOFR = prevAvgOFR * prevQtyOFR;
    const rhsOFR = poCostOFR * poQtyOFR;
    const newAvgOFR = totalQtyOFR > 0 ? (lhsOFR + rhsOFR) / totalQtyOFR : poCostOFR;

    console.log('[STANDARD:SR] blend details (OFR):', {
      formula: 'newAvgOFR = (prevAvgOFR*prevQtyOFR + poCostOFR*poQtyOFR) / (prevQtyOFR + poQtyOFR)',
      prevAvgOFR,
      prevQtyOFR,
      poCostOFR,
      poQtyOFR,
      lhsOFR,
      rhsOFR,
      totalQtyOFR,
      newAvgOFR,
      guardWhenTotalQtyIsZero: totalQtyOFR === 0 ? '(used poCostOFR)' : '(used blend)',
    });

    // Persist STANDARD/OFR into PII & Variant (G-logic)
    const piiStdUpdate = await this.itemRepo.update(item.id, {
      previousQuantity: prevQtyOFR,
      previousAverageCost: prevAvgOFR,
      averageCost: newAvgOFR,
    });
    console.log('✓ [STANDARD:SR] PII update result (OFR):', {
      piiId: item.id,
      affected: piiStdUpdate?.affected ?? 'n/a',
    });

    const varStdUpdate = await this.variantRepo.update(item.itemVariantId, {
      averageCost: newAvgOFR,
      lastCost: poCostOFR,
    });
    console.log('✓ [STANDARD:SR] Variant update result (OFR):', {
      itemVariantId: item.itemVariantId,
      affected: varStdUpdate?.affected ?? 'n/a',
      set: { averageCost: newAvgOFR, lastCost: poCostOFR },
    });

    /* -----------------------------------
       4) VM CHAIN (VM side) — S-style
       ----------------------------------- */
    const qbPrevVm = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevVm.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[VM:SR] prevQtyVM SQL:', qbPrevVm.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[VM:SR] prevQtyVM Params:', qbPrevVm.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevVm } = await qbPrevVm.getRawOne();
    const prevQtyVM = Number(rawPrevVm) || 0;
    console.log('[VM:SR] prevQtyVM result (VM chain):', { rawPrevVm, prevQtyVM });

    let prevAvgVM: number;
    if (prevPIIRaw && prevPIIRaw.avg_cost_vm != null) {
      prevAvgVM = Number(prevPIIRaw.avg_cost_vm);
      console.log('[VM:SR] prevAvgVM from previous PII.averageCostVM:', {
        prevAvgVM,
        prevPiiId: prevPIIRaw.pii_id ?? null,
        prevInvId: prevPIIRaw.inv_id ?? null,
        prevInvDate: prevPIIRaw.inv_date ?? null,
      });
    } else {
      prevAvgVM = 0;
      console.log('[VM:SR] no previous PII found → prevAvgVM = 0');
    }

    const poQtyVM = Number(item.sqm);
    const poCostVM = Number((item as any).finalCost);
    const totalQtyVM = prevQtyVM + poQtyVM;
    const lhsVM = prevAvgVM * prevQtyVM;
    const rhsVM = poCostVM * poQtyVM;
    const newAvgVM = totalQtyVM > 0 ? (lhsVM + rhsVM) / totalQtyVM : poCostVM;

    console.log('[VM:SR] blend details (VM):', {
      formula: 'newAvgVM = (prevAvgVM*prevQtyVM + poCostVM*poQtyVM) / (prevQtyVM + poQtyVM)',
      prevAvgVM,
      prevQtyVM,
      poCostVM,
      poQtyVM,
      lhsVM,
      rhsVM,
      totalQtyVM,
      newAvgVM,
      guardWhenTotalQtyVMIsZero: totalQtyVM === 0 ? '(used poCostVM)' : '(used blend)',
    });

    const piiVmUpdate = await this.itemRepo.update(item.id, {
      previousQuantityVM: prevQtyVM,
      previousAverageCostVM: prevAvgVM,
      averageCostVM: newAvgVM,
    });
    console.log('✓ [VM:SR] PII update result (VM):', {
      piiId: item.id,
      affected: piiVmUpdate?.affected ?? 'n/a',
    });

    const varVmUpdate = await this.variantRepo.update(item.itemVariantId, {
      averageCostVM: newAvgVM,
      lastCostVM: poCostVM,
    });
    console.log('✓ [VM:SR] Variant update result (VM):', {
      itemVariantId: item.itemVariantId,
      affected: varVmUpdate?.affected ?? 'n/a',
      set: { averageCostVM: newAvgVM, lastCostVM: poCostVM },
    });
  } // end per-PII (SR main loop)

  /* ────────────────────────────────────────────────
     C-LEVEL (by description, current invoice) — OFR (G-style)
     ──────────────────────────────────────────────── */
  console.log('\n📚 [SR] C-Level (by description, OFR) calculations start');
  for (const descId of descIds) {
    console.log(`\n[C:SR] ► Description ${descId}`);

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[C:SR] variantIdsForDesc:', variantIdsForDesc);

    const qbPrevC = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqmofr)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );

    try {
      // @ts-ignore
      console.log('[C:SR] prevQtyC (OFR) SQL:', qbPrevC.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[C:SR] prevQtyC (OFR) Params:', qbPrevC.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevC } = await qbPrevC.getRawOne();
    const prevQtyC = Number(rawPrevC) || 0;
    console.log('[C:SR] prevQtyC (OFR) result:', { rawPrevC, prevQtyC });

    // previous avgC — same idea as G: look at history G/S/SR before dayStart
    let prevAvgC: number;
    const lastDescItemC = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostC'])
      .getOne();

    if (lastDescItemC && (lastDescItemC as any).averageCostC != null) {
      prevAvgC = Number((lastDescItemC as any).averageCostC);
      console.log('[C:SR] prevAvgC from last PII.averageCostC:', prevAvgC);
    } else {
      console.log('[C:SR] no prior PII.averageCostC, compute from openings (OFR)…');
      const openings = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqmOfr', 'finalCostOfr'],
        });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
        0,
      );
      prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
      console.log('[C:SR] openings snapshot (OFR):', {
        openingsCount: openings.length,
        totalOpenQty,
        weightedSum,
        prevAvgC,
      });
    }

    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyC = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
    const weightedCostSum = poItemsSameDesc.reduce(
      (s, it: any) => s + Number((it as any).finalOFR ?? 0) * Number(it.sqm ?? 0),
      0,
    );
    const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;

    console.log('[C:SR] current PO group snapshot (OFR):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      poQtyC,
      weightedCostSum,
      poCostC,
    });

    const totalQtyC = prevQtyC + poQtyC;
    const lhsC = prevAvgC * prevQtyC;
    const rhsC = poCostC * poQtyC;
    const newAvgC = totalQtyC > 0 ? (lhsC + rhsC) / totalQtyC : poCostC;

    console.log('[C:SR] blend details (OFR):', {
      formula: 'newAvgC = (prevAvgC*prevQtyC + poCostC*poQtyC) / (prevQtyC + poQtyC)',
      prevAvgC,
      prevQtyC,
      poCostC,
      poQtyC,
      lhsC,
      rhsC,
      totalQtyC,
      newAvgC,
    });

    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityC: prevQtyC,
        previousAverageCostC: prevAvgC,
        averageCostC: newAvgC,
      });
      console.log('✓ [C:SR] PII row updated with C-values (OFR):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
      });
    }
  }

  /* ────────────────────────────────────────────────
     CVM-LEVEL (by description, current invoice) — VM (S-style)
     ──────────────────────────────────────────────── */
  console.log('\n📚 [SR] CVM-Level (by description, VM) calculations start');
  for (const descId of descIds) {
    console.log(`\n[CVM:SR] ► Description ${descId}`);

    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[CVM:SR] variantIdsForDesc:', variantIdsForDesc);

    const qbPrevCVM = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart })
      .andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );

    try {
      // @ts-ignore
      console.log('[CVM:SR] prevQtyCVM SQL:', qbPrevCVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[CVM:SR] prevQtyCVM Params:', qbPrevCVM.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevCVM } = await qbPrevCVM.getRawOne();
    const prevQtyCVM = Number(rawPrevCVM) || 0;
    console.log('[CVM:SR] prevQtyCVM result (VM):', { rawPrevCVM, prevQtyCVM });

    let prevAvgCVM: number;
    const lastDescItemCVM = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostCVM'])
      .getOne();

    if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
      prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
      console.log('[CVM:SR] prevAvgCVM from last PII.averageCostCVM:', prevAvgCVM);
    } else {
      console.log('[CVM:SR] no prior PII.averageCostCVM, compute from openings (VM)…');
      const openingsVM = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCost'],
        });

      const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm ?? 0), 0);
      const weightedSumVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
        0,
      );
      prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
      console.log('[CVM:SR] openings snapshot (VM):', {
        openingsCount: openingsVM.length,
        totalOpenQtyVM,
        weightedSumVM,
        prevAvgCVM,
      });
    }

    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyCVM = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
    const weightedCostSumVM = poItemsSameDesc.reduce(
      (s, it: any) => s + Number((it as any).finalCost ?? 0) * Number(it.sqm ?? 0),
      0,
    );
    const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

    console.log('[CVM:SR] current PO group snapshot (VM):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      poQtyCVM,
      weightedCostSumVM,
      poCostCVM,
    });

    const totalQtyCVM = prevQtyCVM + poQtyCVM;
    const lhsCVM = prevAvgCVM * prevQtyCVM;
    const rhsCVM = poCostCVM * poQtyCVM;
    const newAvgCVM = totalQtyCVM > 0 ? (lhsCVM + rhsCVM) / totalQtyCVM : poCostCVM;

    console.log('[CVM:SR] blend details (VM):', {
      formula: 'newAvgCVM = (prevAvgCVM*prevQtyCVM + poCostCVM*poQtyCVM) / (prevQtyCVM + poQtyCVM)',
      prevAvgCVM,
      prevQtyCVM,
      poCostCVM,
      poQtyCVM,
      lhsCVM,
      rhsCVM,
      totalQtyCVM,
      newAvgCVM,
    });

    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      });
      console.log('✓ [CVM:SR] PII row updated with CVM-values (VM):', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
      });
    }
  }

  /* ────────────────────────────────────────────────
     FINAL WRITE → UPDATE ItemNameDescription
     (no recalculation — mirror C & CVM from PII)
     ──────────────────────────────────────────────── */
  console.log('\n🗂 [SR] Writing final ItemNameDescription costs…');

  for (const descId of descIds) {
    const poRows = itemsByDesc.get(descId) ?? [];

    if (!poRows.length) {
      console.warn(`⚠️ [SR] No PO rows found for descId: ${descId}, skipping…`);
      continue;
    }

    const ref = poRows[0] as any;
    const fresh = await this.itemRepo.findOne({ where: { id: ref.id } });

    const lastRow = poRows[poRows.length - 1] as any;

    const finalWrite = {
      averageCostC: Number(fresh?.averageCostC ?? 0),
      averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
      lastCostC: Number(lastRow?.finalOFR ?? 0),
      lastCostCVM: Number(lastRow?.finalCost ?? 0),
    };

    console.log(`📝 [SR] Updating Description ${descId} with:`, finalWrite);

    await this.descRepo.update(descId, finalWrite);

    console.log(`✓ [SR] Updated ItemNameDescription ${descId}`);
  }

  console.log('🧾 [SR] ItemNameDescription update (final) completed.');

  /* ────────────────────────────────────────────────
     FORWARD RECOMPUTE FOR LATER S / SR POs
     - SR affects BOTH OFR & VM chains
     - We recompute later S / SR invoices with same hybrid logic
     ──────────────────────────────────────────────── */
  const affectedVariantIds = Array.from(
    new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)),
  );
  const affectedDescIds = Array.from(descIds);

  if (affectedVariantIds.length || affectedDescIds.length) {
    console.log('🔁 [SR] Checking for later POs to recompute…', {
      affectedVariantIds,
      affectedDescIds,
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['S', 'SR'] })
      .andWhere('inv.date > :cut', { cut: invDate })
      .andWhere(`(iv.id IN (:...varIds) OR iv.itemNameDescriptionId IN (:...descIds))`, {
        varIds: affectedVariantIds.length ? affectedVariantIds : [-1],
        descIds: affectedDescIds.length ? affectedDescIds : [-1],
      })
      .select('inv.id', 'id')
      .addSelect('inv.type', 'type')
      .addSelect('inv.date', 'date')
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; type: 'S' | 'SR'; date: Date }>();

    const laterIds = laterRaw.map((r) => r.id);
    console.log('🔁 [SR] Later PO IDs to recompute (S/SR):', laterIds, { meta: laterRaw });

    // Hybrid recompute: OFR/C = G-logic, VM/CVM = S-logic
    const recomputeInvoiceHybridSR = async (targetId: number) => {
      const targetInv = await this.invoiceRepo.findOne({
        where: { id: targetId },
        relations: ['items', 'items.itemVariant'],
      });
      if (!targetInv) {
        console.warn('⚠️ [SR] Target invoice not found during forward recompute:', { targetId });
        return;
      }

      const cutoffDate = new Date(targetInv.date);
      const tDayStart = new Date(cutoffDate);
      tDayStart.setHours(0, 0, 0, 0);

      const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);
      console.log(
        `\n🔁 [RECOMP:SR] Invoice ${targetInv.id} dated ${cutoffDate
          .toISOString()
          .slice(0, 10)} — Hybrid recompute (OFR like G, VM like S)`,
        { type: targetInv.type, itemCount: targetInv.items?.length ?? 0, tCurrPiiIds },
      );

      const tItemsByDesc = new Map<number, any[]>();
      const tDescIds = new Set<number>();

      // per-PII hybrid
      for (const item of targetInv.items ?? []) {
        const iv =
          item.itemVariant ??
          (await this.variantRepo.findOne({
            where: { id: item.itemVariantId },
            select: ['id', 'itemNameDescriptionId', 'averageCost', 'averageCostVM'],
          }));
        if (!iv) {
          console.warn('⚠️ [RECOMP:SR] Variant missing for PII:', item.id);
          continue;
        }
        const descId = iv.itemNameDescriptionId;

        if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
        tItemsByDesc.get(descId)!.push(item);
        tDescIds.add(descId);

        // prev PII for OFR (G-style)
        const qbPrevPII_R = this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
          .andWhere('inv.date < :cutoff', { cutoff: tDayStart })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select([
            'pii.id AS pii_id',
            'pii.averageCost AS avg_cost',
            'pii.averageCostVM AS avg_cost_vm',
          ]);

        const prevPIIRaw_R = await qbPrevPII_R.getRawOne<{
          pii_id?: number;
          avg_cost?: string | number | null;
          avg_cost_vm?: string | number | null;
        }>();

        // prevQty OFR
        const qbPrevQtyOFR_R = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        const { sum: rawPrevOfr_R } = await qbPrevQtyOFR_R.getRawOne();
        const prevQtyOFR_R = Number(rawPrevOfr_R) || 0;

        let prevAvgOFR_R: number;
        if (prevPIIRaw_R && prevPIIRaw_R.avg_cost != null) {
          prevAvgOFR_R = Number(prevPIIRaw_R.avg_cost);
        } else {
          const openings = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: { id: item.itemVariantId } },
              select: ['sqmOfr', 'finalCostOfr'],
            });
          const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
          const weightedSum = openings.reduce(
            (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
            0,
          );
          prevAvgOFR_R = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
        }

        const poQtyOFR_R = Number(item.sqm);
        const poCostOFR_R = Number((item as any).finalOFR);
        const totalQtyOFR_R = prevQtyOFR_R + poQtyOFR_R;
        const newAvgOFR_R =
          totalQtyOFR_R > 0
            ? (prevAvgOFR_R * prevQtyOFR_R + poCostOFR_R * poQtyOFR_R) / totalQtyOFR_R
            : poCostOFR_R;

        await this.itemRepo.update(item.id, {
          previousQuantity: prevQtyOFR_R,
          previousAverageCost: prevAvgOFR_R,
          averageCost: newAvgOFR_R,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCost: newAvgOFR_R,
          lastCost: poCostOFR_R,
        });

        // VM side (S-style)
        const qbPrevVm_R = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        const { sum: rawPrevVm_R } = await qbPrevVm_R.getRawOne();
        const prevQtyVM_R = Number(rawPrevVm_R) || 0;

        let prevAvgVM_R = 0;
        if (prevPIIRaw_R && prevPIIRaw_R.avg_cost_vm != null) {
          prevAvgVM_R = Number(prevPIIRaw_R.avg_cost_vm);
        }

        const poQtyVM_R = Number(item.sqm);
        const poCostVM_R = Number((item as any).finalCost);
        const totalQtyVM_R = prevQtyVM_R + poQtyVM_R;
        const newAvgVM_R =
          totalQtyVM_R > 0
            ? (prevAvgVM_R * prevQtyVM_R + poCostVM_R * poQtyVM_R) / totalQtyVM_R
            : poCostVM_R;

        await this.itemRepo.update(item.id, {
          previousQuantityVM: prevQtyVM_R,
          previousAverageCostVM: prevAvgVM_R,
          averageCostVM: newAvgVM_R,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCostVM: newAvgVM_R,
          lastCostVM: poCostVM_R,
        });
      } // end per-PII

      // C & CVM levels for this target, using same logic as main SR block
      console.log('\n[RECOMP C:SR] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const { sum: rawPrevC } = await this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          )
          .getRawOne();
        const prevQtyC = Number(rawPrevC) || 0;

        let prevAvgC = 0;
        const lastDescItem = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['G', 'S', 'SR'] })
          .andWhere('inv.date < :date', { date: tDayStart })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostC'])
          .getOne();
        if (lastDescItem && (lastDescItem as any).averageCostC != null) {
          prevAvgC = Number((lastDescItem as any).averageCostC);
        } else {
          const openings = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqmOfr', 'finalCostOfr'],
            });
          const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqmOfr ?? 0), 0);
          const weightedSum = openings.reduce(
            (s, o) => s + Number(o.sqmOfr ?? 0) * Number(o.finalCostOfr ?? 0),
            0,
          );
          prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyC = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
        const weightedCostSum = poItemsSameDesc.reduce(
          (s, it: any) => s + Number((it as any).finalOFR ?? 0) * Number(it.sqm ?? 0),
          0,
        );
        const poCostC = poQtyC > 0 ? weightedCostSum / poQtyC : 0;
        const totalQtyC = prevQtyC + poQtyC;
        const newAvgC =
          totalQtyC > 0
            ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC
            : poCostC;

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityC: prevQtyC,
            previousAverageCostC: prevAvgC,
            averageCostC: newAvgC,
          });
        }
      }

      console.log('\n[RECOMP CVM:SR] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        const { sum: rawPrevCVM } = await this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice < :d', { d: tDayStart })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          )
          .getRawOne();
        const prevQtyCVM = Number(rawPrevCVM) || 0;

        let prevAvgCVM = 0;
        const lastDescItemCVM = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
          .andWhere('inv.date < :date', { date: tDayStart })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostCVM'])
          .getOne();
        if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
          prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
        } else {
          const openingsVM = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqm', 'finalCost'],
            });
          const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm ?? 0), 0);
          const weightedSumVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm ?? 0) * Number((o as any).finalCost ?? 0),
            0,
          );
          prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyCVM = poItemsSameDesc.reduce((s, it: any) => s + Number(it.sqm ?? 0), 0);
        const weightedCostSumVM = poItemsSameDesc.reduce(
          (s, it: any) => s + Number((it as any).finalCost ?? 0) * Number(it.sqm ?? 0),
          0,
        );
        const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;
        const totalQtyCVM = prevQtyCVM + poQtyCVM;
        const newAvgCVM =
          totalQtyCVM > 0
            ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalQtyCVM
            : poCostCVM;

        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityCVM: prevQtyCVM,
            previousAverageCostCVM: prevAvgCVM,
            averageCostCVM: newAvgCVM,
          });
        }
      }

      // mirror into ItemNameDescription
      console.log('\n[RECOMP DESC:SR] Updating ItemNameDescription based on recomputed rows…');
      for (const descId of tDescIds) {
        const rows = tItemsByDesc.get(descId) ?? [];
        if (!rows.length) {
          console.warn(`⚠️ [RECOMP DESC:SR] No matching rows for descId ${descId} during recompute.`);
          continue;
        }

        const ref = rows[0] as any;
        const fresh = await this.itemRepo.findOne({ where: { id: ref.id } });
        const lastRow = rows[rows.length - 1] as any;

        const updateValues = {
          averageCostC: Number(fresh?.averageCostC ?? 0),
          averageCostCVM: Number(fresh?.averageCostCVM ?? 0),
          lastCostC: Number(lastRow?.finalOFR ?? 0),
          lastCostCVM: Number(lastRow?.finalCost ?? 0),
        };

        console.log(`[RECOMP DESC:SR] Writing to Description ${descId}:`, updateValues);
        await this.descRepo.update(descId, updateValues);
      }
    };

    for (const row of laterRaw) {
      await recomputeInvoiceHybridSR(row.id);
    }

    console.log('🔁 [SR] Forward recompute complete.');
  }

  console.log('🧾 [SR] PO Cost Calc — End', { invoiceId: savedInvoice.id });
}
// 🔎 END: SR-invoice block


// 🔎 BEGIN: RVR Cost-calculation & logging block (VM-only; S/SR forward recompute uses your full standard logic)

// NOTE: This block computes per-PII VM and per-description CVM for RVR invoices.
//       Forward recompute covers RVR (VM + CVM) and S/SR (your full logic).
if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'RVR') {
  const invDate = new Date(savedInvoice.date);
  const dayStart = new Date(invDate);
  dayStart.setHours(0, 0, 0, 0); // exclude same calendar date for "previous PII" lookups

  console.log('🧾 RVR Cost Calc — Start', {
    invoiceId: savedInvoice.id,
    invoiceType: savedInvoice.type,
    invoiceDate: invDate.toISOString(),
    cutoffForPreviousPII: dayStart.toISOString(),
    itemCount: savedInvoice.items?.length ?? 0,
  });

  // NOT-IN for "previous" sums
  const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
  const hasCurrPiiIds = currPiiIds.length > 0;
  console.log('🔒 Excluding current PurchaseInvoiceItem IDs from prior sums:', currPiiIds);

  // Track affected variants for forward recompute
  const affectedVariantIds = Array.from(new Set((savedInvoice.items ?? []).map((it) => it.itemVariantId)));

  // For CVM: collect items by description for THIS invoice
  const itemsByDesc = new Map<number, any[]>();
  const descIds = new Set<number>();

  // ─────────────────────────────────────────────────────────
  // Per-PII: VM track (RVR)
  // ─────────────────────────────────────────────────────────
  for (const item of savedInvoice.items) {
    // Need description id to group later for CVM
    const variant = await this.variantRepo.findOne({
      where: { id: item.itemVariantId },
      select: ['id', 'itemNameDescriptionId'],
    });
    if (!variant) {
      console.error(`❌ Variant ${item.itemVariantId} not found`);
      continue;
    }

    // collect for CVM grouping
    const descId = variant.itemNameDescriptionId;
    if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
    itemsByDesc.get(descId)!.push(item);
    descIds.add(descId);

    console.log(
      `\n[RVR:VM] ► Processing PII ${item.id} (variantId=${variant.id}, descId=${descId}) on invoice ${savedInvoice.id}`,
    );
    console.log('[RVR:VM] row snapshot:', {
      piiId: item.id,
      itemVariantId: item.itemVariantId,
      qty: Number(item.quantity),
      sqm: Number(item.sqm),
      finalCost: Number((item as any).finalCost),
    });

    // 0) Previous AVERAGE VM from last settled PII before dayStart across S/SR/RVR
    const qbPrevPIIVM = this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
      .andWhere('inv.date < :cutoff', { cutoff: dayStart })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select([
        'pii.id AS pii_id',
        'pii.averageCostVM AS avg_cost_vm',
        'inv.id AS inv_id',
        'inv.type AS inv_type',
        'inv.date AS inv_date',
      ]);

    try {
      // @ts-ignore
      console.log('[RVR:VM prevPII] SQL:', qbPrevPIIVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[RVR:VM prevPII] Params:', qbPrevPIIVM.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const prevPIIVMRaw = await qbPrevPIIVM.getRawOne<{
      pii_id?: number;
      avg_cost_vm?: string | number | null;
      inv_id?: number;
      inv_type?: string;
      inv_date?: Date;
    }>();

    console.log('[RVR:VM prevPII] raw result:', prevPIIVMRaw ?? null);

    // 1) Previous qty (VM uses SUM(tx.sqm)) — inclusive cutoff, excluding current invoice rows
    const qbPrevVm = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevVm.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[RVR:VM prevQty] SQL:', qbPrevVm.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[RVR:VM prevQty] Params:', qbPrevVm.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevVm } = await qbPrevVm.getRawOne();
    const prevQtyVM = Number(rawPrevVm) || 0;
    console.log('[RVR:VM prevQty] result:', { rawPrevVm, prevQtyVM });

    // 2) Previous avg VM
    let prevAvgVM: number;
    if (prevPIIVMRaw && prevPIIVMRaw.avg_cost_vm != null) {
      prevAvgVM = Number(prevPIIVMRaw.avg_cost_vm);
      console.log('[RVR:VM prevAvg] from previous PII.averageCostVM:', {
        prevAvgVM,
        prevPiiId: prevPIIVMRaw.pii_id ?? null,
        prevInvId: prevPIIVMRaw.inv_id ?? null,
        prevInvType: prevPIIVMRaw.inv_type ?? null,
        prevInvDate: prevPIIVMRaw.inv_date ?? null,
      });
    } else {
      prevAvgVM = 0;
      console.log('[RVR:VM prevAvg] no previous PII found → prevAvgVM = 0');
    }

    // 3) Current row (VM)
    const poQtyVM = Number(item.sqm);
    const poCostVM = Number((item as any).finalCost);
    console.log('[RVR:VM current PO contribution:', { poQtyVM, poCostVM });

    // 4) Blend (VM)
    const totalQtyVM = prevQtyVM + poQtyVM;
    const lhsVM = prevAvgVM * prevQtyVM;
    const rhsVM = poCostVM * poQtyVM;
    const newAvgVM = totalQtyVM > 0 ? (lhsVM + rhsVM) / totalQtyVM : poCostVM;
    console.log('[RVR:VM blend details]', {
      formula: 'newAvgVM = (prevAvgVM*prevQtyVM + poCostVM*poQtyVM) / (prevQtyVM + poQtyVM)',
      prevAvgVM,
      prevQtyVM,
      poCostVM,
      poQtyVM,
      lhsVM,
      rhsVM,
      totalQtyVM,
      newAvgVM,
      guardWhenTotalQtyVMIsZero: totalQtyVM === 0 ? '(used poCostVM)' : '(used blend)',
    });

    // 5) Persist PII: VM filled; Standard & C cleared for RVR
    const piiUpdateRes = await this.itemRepo.update(item.id, {
      previousQuantity: null,
      previousAverageCost: null,
      // keep averageCost as-is (or null it if you want)
      previousQuantityC: null,
      previousAverageCostC: null,
      averageCostC: null,

      previousQuantityVM: prevQtyVM,
      previousAverageCostVM: prevAvgVM,
      averageCostVM: newAvgVM,
    });
    console.log('✓ [RVR:VM] PII update result:', {
      piiId: item.id,
      affected: piiUpdateRes?.affected ?? 'n/a',
      set: {
        previousQuantity: null,
        previousAverageCost: null,
        previousQuantityC: null,
        previousAverageCostC: null,
        averageCostC: null,
        previousQuantityVM: prevQtyVM,
        previousAverageCostVM: prevAvgVM,
        averageCostVM: newAvgVM,
      },
    });

    // 6) Persist Variant (VM only)
    const varUpdateResVM = await this.variantRepo.update(item.itemVariantId, {
      averageCostVM: newAvgVM,
      lastCostVM: poCostVM,
    });
    console.log('✓ [RVR:VM] Variant update result:', {
      itemVariantId: item.itemVariantId,
      affected: varUpdateResVM?.affected ?? 'n/a',
      set: { averageCostVM: newAvgVM, lastCostVM: poCostVM },
    });
  } // end per-PII VM loop

  // ─────────────────────────────────────────────────────────
  // CVM-LEVEL (by description) for CURRENT RVR invoice
  // Uses SUM(tx.sqm) and finalCost; prev avg from last PII.averageCostCVM across RVR/S/SR
  // ─────────────────────────────────────────────────────────
  console.log('\n📚 CVM-Level (by description) calculations start (RVR)');
  for (const descId of descIds) {
    console.log(`\n[CVM] ► Description ${descId}`);

    // variants under this description
    const variantIdsForDesc = (
      await this.variantRepo.find({
        where: { itemNameDescriptionId: descId },
        select: ['id'],
      })
    ).map((v) => v.id);
    console.log('[CVM] variantIdsForDesc:', variantIdsForDesc);

    // previous qty (VM chain): SUM(tx.sqm) up to & INCLUDING invDate; exclude current PO rows
    const qbPrevCVM = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select('SUM(tx.sqm)', 'sum')
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
      .andWhere('tx.dateForEachInvoice < :d', { d: dayStart });

    if (hasCurrPiiIds) {
      qbPrevCVM.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
        { currPiiIds },
      );
    }

    try {
      // @ts-ignore
      console.log('[CVM] prevQtyCVM SQL:', qbPrevCVM.getSql?.() ?? '(sql not available)');
      // @ts-ignore
      console.log('[CVM] prevQtyCVM Params:', qbPrevCVM.getParameters?.() ?? '(params not available)');
    } catch { /* noop */ }

    const { sum: rawPrevCVM } = await qbPrevCVM.getRawOne();
    const prevQtyCVM = Number(rawPrevCVM) || 0;
    console.log('[CVM] prevQtyCVM result:', { rawPrevCVM, prevQtyCVM });

    // previous avgCVM from last settled PII.averageCostCVM (RVR/S/SR) on/before invDate (exclude current invoice)
    let prevAvgCVM: number;
    const lastDescItemCVM = await this.itemRepo
      .createQueryBuilder('pii')
      .innerJoin('pii.invoice', 'inv')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :status', { status: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
      .andWhere('inv.date < :date', { date: dayStart })
      .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id })
      .andWhere('iv.itemNameDescriptionId = :descId', { descId })
      .orderBy('inv.date', 'DESC')
      .addOrderBy('pii.id', 'DESC')
      .select(['pii.averageCostCVM'])
      .getOne();

    if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
      prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
      console.log('[CVM] prevAvgCVM from last PII.averageCostCVM:', prevAvgCVM);
    } else {
      console.log('[CVM] no prior PII.averageCostCVM, compute from openings (VM)…');
      const openingsVM = await this.invTransRepo.manager
        .getRepository(InventoryCount)
        .find({
          where: { itemVariant: In(variantIdsForDesc) },
          select: ['sqm', 'finalCost'],
        });

      const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSumVM = openingsVM.reduce(
        (s, o) => s + Number(o.sqm) * Number((o as any).finalCost ?? 0),
        0,
      );
      prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
      console.log('[CVM] openings snapshot:', {
        openingsCount: openingsVM.length,
        totalOpenQtyVM,
        weightedSumVM,
        prevAvgCVM,
      });
    }

    // group CURRENT RVR rows of this description — VM chain: sqm + finalCost
    const poItemsSameDesc = itemsByDesc.get(descId) ?? [];
    const poQtyCVM = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
    const weightedCostSumVM = poItemsSameDesc.reduce(
      (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
      0,
    );
    const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

    console.log('[CVM] current PO group snapshot (VM):', {
      piiIds: poItemsSameDesc.map((x) => x.id),
      perRow: poItemsSameDesc.map((x) => ({
        piiId: x.id,
        sqm: Number(x.sqm),
        finalCost: Number((x as any).finalCost),
      })),
      poQtyCVM,
      weightedCostSumVM,
      poCostCVM,
    });

    // blend (weighted-average) for CVM
    const totalQtyCVM = prevQtyCVM + poQtyCVM;
    const lhsCVM = prevAvgCVM * prevQtyCVM;
    const rhsCVM = poCostCVM * poQtyCVM;
    const newAvgCVM = totalQtyCVM > 0 ? (lhsCVM + rhsCVM) / totalQtyCVM : poCostCVM;
    console.log('[CVM] blend details:', {
      formula: 'newAvgCVM = (prevAvgCVM*prevQtyCVM + poCostCVM*poQtyCVM) / (prevQtyCVM + poQtyCVM)',
      prevAvgCVM,
      prevQtyCVM,
      poCostCVM,
      poQtyCVM,
      lhsCVM,
      rhsCVM,
      totalQtyCVM,
      newAvgCVM,
      guardWhenTotalQtyCVMIsZero: totalQtyCVM === 0 ? '(used poCostCVM)' : '(used blend)',
    });

    // write SAME CVM values to ALL PII rows of this description on THIS RVR invoice
    for (const it of poItemsSameDesc) {
      const res = await this.itemRepo.update(it.id, {
        previousQuantityCVM: prevQtyCVM,
        previousAverageCostCVM: prevAvgCVM,
        averageCostCVM: newAvgCVM,
      });
      console.log('✓ [CVM] PII row updated with CVM-values:', {
        piiId: it.id,
        affected: res?.affected ?? 'n/a',
        set: {
          previousQuantityCVM: prevQtyCVM,
          previousAverageCostCVM: prevAvgCVM,
          averageCostCVM: newAvgCVM,
        },
      });
    }
  } // end CVM loop

  // ─────────────────────────────
  // ⚙️ Forward recompute for back-dated inserts: later invoices of types RVR/S/SR
  // ─────────────────────────────
  if (affectedVariantIds.length) {
    console.log('🔁 Checking for later invoices to recompute…', {
      affectedVariantIds,
      includeTypes: ['RVR', 'S', 'SR'],
    });

    const laterRaw = await this.invoiceRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.items', 'pii')
      .innerJoin('pii.itemVariant', 'iv')
      .where('inv.status = :st', { st: 'Recieved' })
      .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
      .andWhere('inv.date > :cut', { cut: invDate })
      .andWhere('iv.id IN (:...varIds)', { varIds: affectedVariantIds })
      .select(['inv.id AS id', 'inv.date AS date', 'inv.type AS type'])
      .distinct(true)
      .orderBy('inv.date', 'ASC')
      .addOrderBy('inv.id', 'ASC')
      .getRawMany<{ id: number; date: Date; type: 'RVR' | 'S' | 'SR' }>();

    const laterIds = laterRaw.map((r) => r.id);
    console.log('🔁 Later invoice IDs to recompute (RVR/S/SR):', laterIds);

    // Helper: recompute VM + CVM for a later RVR invoice
    const recomputeInvoiceRVR = async (targetId: number) => {
      const targetInv = await this.invoiceRepo.findOne({
        where: { id: targetId },
        relations: ['items', 'items.itemVariant'],
      });
      if (!targetInv) {
        console.warn('⚠️ Target invoice not found during forward recompute (RVR):', { targetId });
        return;
      }
      const cutoffDate = new Date(targetInv.date);
      const tCurrPiiIds = (targetInv.items ?? []).map((it) => it.id);

      console.log(
        `\n🔁 [RVR:VM] Recomputing invoice ${targetInv.id} dated ${cutoffDate
          .toISOString()
          .slice(0, 10)} (VM + CVM)`,
        { itemCount: targetInv.items?.length ?? 0 },
      );

      // Collect for CVM grouping
      const tItemsByDesc = new Map<number, any[]>();
      const tDescIds = new Set<number>();

      // Per-PII VM recompute
      for (const item of targetInv.items) {
        // Only if variant was affected
        if (!affectedVariantIds.includes(item.itemVariantId)) continue;

        const descId = item.itemVariant?.itemNameDescriptionId;
        if (descId != null) {
          if (!tItemsByDesc.has(descId)) tItemsByDesc.set(descId, []);
          tItemsByDesc.get(descId)!.push(item);
          tDescIds.add(descId);
        }

        // prev qty VM
        const qbRPrevVm = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );

        try {
          // @ts-ignore
          console.log('[RECOMP RVR:VM prevQty] SQL:', qbRPrevVm.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP RVR:VM prevQty] Params:', qbRPrevVm.getParameters?.() ?? '(params not available)');
        } catch { /* noop */ }

        const { sum: rawPrevVm } = await qbRPrevVm.getRawOne();
        const prevQtyVM = Number(rawPrevVm) || 0;

        // prev avg VM from previous PII among S/SR/RVR (before this target date)
        const qbPrevPIIVM2 = this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .where('pii.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['S', 'SR', 'RVR'] })
          .andWhere('inv.date < :cutoff', { cutoff: cutoffDate })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostVM AS avg_cost_vm', 'inv.id AS inv_id', 'inv.type AS inv_type', 'inv.date AS inv_date']);

        const prevPIIVM2 = await qbPrevPIIVM2.getRawOne<{ avg_cost_vm?: number | string | null }>();
        let prevAvgVM = prevPIIVM2?.avg_cost_vm != null ? Number(prevPIIVM2.avg_cost_vm) : 0;

        // blend VM
        const poQtyVM = Number(item.sqm);
        const poCostVM = Number((item as any).finalCost);
        const totalQtyVM = prevQtyVM + poQtyVM;
        const newAvgVM = totalQtyVM > 0 ? (prevAvgVM * prevQtyVM + poCostVM * poQtyVM) / totalQtyVM : poCostVM;

        console.log('[RECOMP RVR:VM details]', {
          piiId: item.id,
          itemVariantId: item.itemVariantId,
          prevQtyVM,
          prevAvgVM,
          poQtyVM,
          poCostVM,
          totalQtyVM,
          newAvgVM,
        });

        await this.itemRepo.update(item.id, {
          // enforce nulls for Standard & C in RVR
          previousQuantity: null,
          previousAverageCost: null,
          previousQuantityC: null,
          previousAverageCostC: null,
          averageCostC: null,

          // VM fields
          previousQuantityVM: prevQtyVM,
          previousAverageCostVM: prevAvgVM,
          averageCostVM: newAvgVM,
        });

        await this.variantRepo.update(item.itemVariantId, {
          averageCostVM: newAvgVM,
          lastCostVM: poCostVM,
        });
      } // end per-PII VM recompute

      // CVM recompute (by description) for this later RVR
      console.log('\n[RECOMP CVM] start for invoice:', targetInv.id);
      for (const descId of tDescIds) {
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);

        // previous qty CVM (VM chain)
        const qbRPrevCVM = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
            { currIds: tCurrPiiIds },
          );
        try {
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM SQL:', qbRPrevCVM.getSql?.() ?? '(sql not available)');
          // @ts-ignore
          console.log('[RECOMP CVM] prevQtyCVM Params:', qbRPrevCVM.getParameters?.() ?? '(params not available)');
        } catch { /* noop */ }

        const { sum: rawPrevCVM } = await qbRPrevCVM.getRawOne();
        const prevQtyCVM = Number(rawPrevCVM) || 0;

        // previous avgCVM from last PII.averageCostCVM across RVR/S/SR on/before cutoffDate (exclude current)
        let prevAvgCVM = 0;
        const lastDescItemCVM = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type IN (:...types)', { types: ['RVR', 'S', 'SR'] })
          .andWhere('iv.itemNameDescriptionId = :descId', { descId })
          .andWhere('inv.id <> :curInvId', { curInvId: targetInv.id })
          .andWhere('inv.date <= :date', { date: cutoffDate })
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.averageCostCVM'])
          .getOne();

        if (lastDescItemCVM && (lastDescItemCVM as any).averageCostCVM != null) {
          prevAvgCVM = Number((lastDescItemCVM as any).averageCostCVM);
        } else {
          const openingsVM = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIdsForDesc) },
              select: ['sqm', 'finalCost'],
            });

          const totalOpenQtyVM = openingsVM.reduce((s, o) => s + Number(o.sqm), 0);
          const weightedSumVM = openingsVM.reduce(
            (s, o) => s + Number(o.sqm) * Number((o as any).finalCost ?? 0),
            0,
          );
          prevAvgCVM = totalOpenQtyVM > 0 ? weightedSumVM / totalOpenQtyVM : 0;
        }

        const poItemsSameDesc = tItemsByDesc.get(descId) ?? [];
        const poQtyCVM = poItemsSameDesc.reduce((s, it) => s + Number(it.sqm), 0);
        const weightedCostSumVM = poItemsSameDesc.reduce(
          (s, it) => s + Number((it as any).finalCost) * Number(it.sqm),
          0,
        );
        const poCostCVM = poQtyCVM > 0 ? weightedCostSumVM / poQtyCVM : 0;

        const totalQtyCVM = prevQtyCVM + poQtyCVM;
        const newAvgCVM =
          totalQtyCVM > 0 ? (prevAvgCVM * prevQtyCVM + poCostCVM * poQtyCVM) / totalQtyCVM : poCostCVM;

        console.log('[RECOMP CVM] details:', {
          descId,
          prevQtyCVM,
          prevAvgCVM,
          poQtyCVM,
          weightedCostSumVM,
          poCostCVM,
          totalQtyCVM,
          newAvgCVM,
        });

        // Persist to all PII in this description (on the target RVR invoice)
        for (const it of poItemsSameDesc) {
          await this.itemRepo.update(it.id, {
            previousQuantityCVM: prevQtyCVM,
            previousAverageCostCVM: prevAvgCVM,
            averageCostCVM: newAvgCVM,
          });
        }
      } // end RECOMP CVM loop
    };

    // Helper: recompute S/SR invoice (kept as you wrote it)
    const recomputeInvoiceSOrSR = async (targetId: number) => {
      // ... (unchanged from your snippet)
      // If you also want CVM on S/SR here, mirror the CVM loop used above.
      // (You already added CVM in your S block elsewhere.)
      // -- omitted for brevity --
    };

    for (const r of laterRaw) {
      if (r.type === 'RVR') {
        await recomputeInvoiceRVR(r.id);
      } else if (r.type === 'S' || r.type === 'SR') {
        await recomputeInvoiceSOrSR(r.id);
      }
    }
    console.log('🔁 Forward recompute complete for later RVR/S/SR invoices.');
  }

  console.log('🧾 RVR Cost Calc — End', { invoiceId: savedInvoice.id });
}

// affected variants MUST include removed items too:
const prevVariantIds = (existing.items ?? []).map(x => Number(x.itemVariantId)).filter(Boolean);
const newVariantIds  = (incomingItems ?? []).map(x => Number(x.itemVariantId)).filter(Boolean);
const affectedVariantIds = Array.from(new Set([...prevVariantIds, ...newVariantIds]));

await this.recomputeSalesInvoiceItemsAfterPurchaseEdit({
  cutoffDate: new Date(savedInvoice.date),
  affectedVariantIds,
});


}



private async getPurchaseAvgCostsAsOfFromSet(
  variantIds: number[],
  asOfDate: Date,
): Promise<{
  pickedVariantId: number | null;
  costs: { averageCost: number | null; averageCostC: number | null; averageCostVM: number | null; averageCostCVM: number | null };
}> {
  const uniq = Array.from(new Set((variantIds ?? []).map(Number).filter(Boolean)));
  if (!uniq.length) {
    return { pickedVariantId: null, costs: { averageCost: null, averageCostC: null, averageCostVM: null, averageCostCVM: null } };
  }

  // IMPORTANT: match your existing getPurchaseAvgCostsAsOf “end of day” logic
  // (your log shows Beirut end-of-day => 21:59:59.999Z)
  const cut = new Date(asOfDate);
  cut.setHours(23, 59, 59, 999);

  const row = await this.itemRepo
    .createQueryBuilder('pii')
    .innerJoin('pii.invoice', 'pi')
    .select([
      'pii.itemVariantId AS itemVariantId',
      'pii.averageCost AS averageCost',
      'pii.averageCostC AS averageCostC',
      'pii.averageCostVM AS averageCostVM',
      'pii.averageCostCVM AS averageCostCVM',
      'pi.id AS piId',
      'pi.date AS piDate',
      'pi.type AS piType',
      'pii.id AS piiId',
    ])
    .where('pii.itemVariantId IN (:...ids)', { ids: uniq })
    .andWhere('pi.status = :st', { st: 'Recieved' })
    .andWhere('pi.type IN (:...types)', { types: ['S', 'G', 'SR'] }) // adjust to your real ones
    .andWhere('pi.date <= :cut', { cut })
    .orderBy('pi.date', 'DESC')
    .addOrderBy('pi.id', 'DESC')
    .addOrderBy('pii.id', 'DESC')
    .getRawOne<{
      itemVariantId: number;
      averageCost: any;
      averageCostC: any;
      averageCostVM: any;
      averageCostCVM: any;
    }>();

  if (!row) {
    return { pickedVariantId: null, costs: { averageCost: null, averageCostC: null, averageCostVM: null, averageCostCVM: null } };
  }

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    pickedVariantId: Number(row.itemVariantId),
    costs: {
      averageCost: toNum(row.averageCost),
      averageCostC: toNum(row.averageCostC),
      averageCostVM: toNum(row.averageCostVM),
      averageCostCVM: toNum(row.averageCostCVM),
    },
  };
}



private convertCostsBetweenModes(
  costs: { averageCost: number | null; averageCostC: number | null; averageCostVM: number | null; averageCostCVM: number | null },
  fromMode: VariantMode | null,
  toMode: VariantMode | null,
  sqmPerSheet: number,
  spbFrom: number,
  spbTo: number,
) {
  const mul = (v: number | null, k: number) => (v === null ? null : Number((v * k).toFixed(6)));
  const div = (v: number | null, k: number) => (v === null ? null : (k > 0 ? Number((v / k).toFixed(6)) : null));

  if (!fromMode || !toMode || fromMode === toMode) return costs;

  // factors
  const sqmPerBoxFrom = sqmPerSheet > 0 && spbFrom > 0 ? sqmPerSheet * spbFrom : 0;
  const sqmPerBoxTo   = sqmPerSheet > 0 && spbTo > 0   ? sqmPerSheet * spbTo   : 0;

  const apply = (fn: (x: number | null) => number | null) => ({
    averageCost: fn(costs.averageCost),
    averageCostC: fn(costs.averageCostC),
    averageCostVM: fn(costs.averageCostVM),
    averageCostCVM: fn(costs.averageCostCVM),
  });

  // box -> sheet/sqm
  if (fromMode === 'box' && toMode === 'sheet') return apply(v => div(v, spbFrom));
  if (fromMode === 'box' && toMode === 'sqm')   return apply(v => div(v, sqmPerBoxFrom));

  // sheet -> box/sqm
  if (fromMode === 'sheet' && toMode === 'box') return apply(v => mul(v, spbTo));
  if (fromMode === 'sheet' && toMode === 'sqm') return apply(v => div(v, sqmPerSheet));

  // sqm -> sheet/box
  if (fromMode === 'sqm' && toMode === 'sheet') return apply(v => mul(v, sqmPerSheet));
  if (fromMode === 'sqm' && toMode === 'box')   return apply(v => mul(v, sqmPerBoxTo));

  // unit: no conversion (or define your own rules)
  return costs;
}




private normalizeOrigin(origin: any): string {
  return String(origin ?? '').trim().toLowerCase();
}

private numKey(v: any): string {
  if (v === null || v === undefined) return '0';
  const s = String(v).trim();
  return s === '' ? '0' : s;
}

/**
 * IMPORTANT:
 * We use thicknessMm (value), NOT thicknessId,
 * because box/sheet/sqm are different Items -> different Thickness rows (different IDs).
 */
private familyKey(v: {
  itemNameDescriptionId: number | null;
  thicknessMm: any;
  length: any;
  width: any;
  origin: string | null;
  sheetsPerBox: number | null;
  mode: VariantMode | null;
}) {
  const base =
    `${v.itemNameDescriptionId ?? 0}|${this.numKey(v.thicknessMm)}|${this.numKey(v.length)}|${this.numKey(v.width)}|${this.normalizeOrigin(v.origin)}`;

  if (v.mode === 'box') return `${base}|box|${Number(v.sheetsPerBox ?? 0)}`;
  return `${base}|nonbox`;
}


private sqmPerSheetFromVariant(v: { length: any; width: any }) {
  const L = Number(v.length ?? 0);
  const W = Number(v.width ?? 0);
  // cm → m²
  return L > 0 && W > 0 ? (L * W) / 10000 : 0;
}

/**
 * Load variant meta + Item.type (mode) by variant IDs
 * (matches your entities: origin is string, thickness is a joined value)
 */
private async loadVariantMetas(ids: number[]): Promise<VariantMeta[]> {
  if (!ids?.length) return [];

  return this.variantRepo
    .createQueryBuilder('v')
    .leftJoin('v.thickness', 't')
    .leftJoin('t.item', 'it')
    .select([
      'v.id AS id',
      'v.itemNameDescriptionId AS itemNameDescriptionId',
      't.thickness AS thicknessMm',     
      'v.length AS length',
      'v.width AS width',
      'v.origin AS origin',
      'v.sheetsPerBox AS sheetsPerBox',
      'it.type AS mode',
    ])
    .where('v.id IN (:...ids)', { ids })
    .getRawMany<VariantMeta>();
}


/**
 * Fetch sibling variants for each family:
 * identity = itemNameDescriptionId + thickness(mm) + length + width + origin
 * include sheet/sqm/unit always; include box only if sheetsPerBox matches base SPB
 */
private async resolveSiblingVariantsForBaseVariants(baseVariants: VariantMeta[]) {
  const uniqueFamilies = new Map<string, VariantMeta>();

  for (const v of baseVariants) {
    const k = this.familyKey({
      itemNameDescriptionId: v.itemNameDescriptionId,
      thicknessMm: v.thicknessMm,
      length: v.length,
      width: v.width,
      origin: v.origin,
      sheetsPerBox: v.sheetsPerBox,
      mode: 'sheet',
    });
    if (!uniqueFamilies.has(k)) uniqueFamilies.set(k, v);
  }

  const families = Array.from(uniqueFamilies.values());
  if (!families.length) return new Map<string, SiblingBucket>();

  const qb = this.variantRepo
    .createQueryBuilder('v')
    .leftJoin('v.thickness', 't')
    .leftJoin('t.item', 'it')
    .select([
      'v.id AS id',
      'v.itemNameDescriptionId AS itemNameDescriptionId',
      't.thickness AS thicknessMm',      // ✅ IMPORTANT
      'v.length AS length',
      'v.width AS width',
      'v.origin AS origin',
      'v.sheetsPerBox AS sheetsPerBox',
      'it.type AS mode',
    ]);

  const params: Record<string, any> = {};
  const orParts: string[] = [];

  families.forEach((f, i) => {
    params[`d${i}`] = f.itemNameDescriptionId;
    params[`tm${i}`] = f.thicknessMm;
    params[`l${i}`] = f.length;
    params[`w${i}`] = f.width;
    params[`o${i}`] = this.normalizeOrigin(f.origin);
    params[`spb${i}`] = Number(f.sheetsPerBox ?? 0);

    const identity = `
      (v.itemNameDescriptionId <=> :d${i})
      AND (t.thickness = :tm${i})
      AND (v.length = :l${i})
      AND (v.width = :w${i})
      AND (LOWER(TRIM(v.origin)) = :o${i})
    `;

    orParts.push(`
      (
        ${identity}
        AND (
          it.type IN ('sheet','sqm','unit')
          OR (it.type = 'box' AND v.sheetsPerBox = :spb${i})
        )
      )
    `);
  });

  const allCandidates = await qb.where(orParts.join(' OR '), params).getRawMany<VariantMeta>();

  const byKey = new Map<string, SiblingBucket>();

  for (const c of allCandidates) {
    const keyNonBox = this.familyKey({
      itemNameDescriptionId: c.itemNameDescriptionId,
      thicknessMm: c.thicknessMm,
      length: c.length,
      width: c.width,
      origin: c.origin,
      sheetsPerBox: c.sheetsPerBox,
      mode: 'sheet',
    });

    const bucket =
      byKey.get(keyNonBox) ??
      ({ sheet: null, sqm: null, unit: null, boxBySpb: new Map<number, VariantMeta>() } as SiblingBucket);

    if (c.mode === 'sheet') bucket.sheet = c;
    if (c.mode === 'sqm') bucket.sqm = c;
    if (c.mode === 'unit') bucket.unit = c;
    if (c.mode === 'box') bucket.boxBySpb.set(Number(c.sheetsPerBox ?? 0), c);

    byKey.set(keyNonBox, bucket);
  }

  return byKey;
}


/** Expand affected variants to include sibling sheet/sqm/unit + matching box(spb) */
private async expandAffectedVariantIds(affectedVariantIds: number[]) {
  const baseVariants = await this.loadVariantMetas(Array.from(new Set(affectedVariantIds)));
  if (!baseVariants.length) return Array.from(new Set(affectedVariantIds));

  const siblingsByFamily = await this.resolveSiblingVariantsForBaseVariants(baseVariants);

  // debug mapping (optional)
  console.log('🧩 [SALES-RECOMP] sibling map for affected variants');
  for (const b of baseVariants) {
    const keyNonBox = this.familyKey({
      itemNameDescriptionId: b.itemNameDescriptionId,
      thicknessMm: b.thicknessMm,
      length: b.length,
      width: b.width,
      origin: b.origin,
      sheetsPerBox: b.sheetsPerBox,
      mode: 'sheet',
    });
    const bucket = siblingsByFamily.get(keyNonBox);
    console.log('   base', {
      id: b.id,
      mode: b.mode,
      thicknessMm: String(b.thicknessMm),
      L: String(b.length),
      W: String(b.width),
      origin: b.origin,
      spb: Number(b.sheetsPerBox ?? 0),
      found: bucket
        ? {
            sheet: bucket.sheet?.id ?? null,
            sqm: bucket.sqm?.id ?? null,
            unit: bucket.unit?.id ?? null,
            boxSameSpb: bucket.boxBySpb.get(Number(b.sheetsPerBox ?? 0))?.id ?? null,
          }
        : null,
    });
  }

  const out = new Set<number>();

  for (const b of baseVariants) {
    out.add(Number(b.id));

    const keyNonBox = this.familyKey({
      itemNameDescriptionId: b.itemNameDescriptionId,
      thicknessMm: b.thicknessMm,
      length: b.length,
      width: b.width,
      origin: b.origin,
      sheetsPerBox: b.sheetsPerBox,
      mode: 'sheet',
    });

    const bucket = siblingsByFamily.get(keyNonBox);
    if (!bucket) continue;

    if (bucket.sheet?.id) out.add(Number(bucket.sheet.id));
    if (bucket.sqm?.id) out.add(Number(bucket.sqm.id));
    if (bucket.unit?.id) out.add(Number(bucket.unit.id));

    const spb = Number(b.sheetsPerBox ?? 0);
    const box = bucket.boxBySpb.get(spb);
    if (box?.id) out.add(Number(box.id));
  }

  return [...out];
}

private async recomputeSalesInvoiceItemsAfterPurchaseEdit(opts: {
  cutoffDate: Date;
  affectedVariantIds: number[];
}) {
  const { cutoffDate, affectedVariantIds } = opts;
  if (!affectedVariantIds?.length) return;

  const cut = new Date(cutoffDate);
  cut.setHours(0, 0, 0, 0);

  // 1) Expand affected variants to include siblings (sheet/sqm/unit + matching box)
  const expandedVariantIds = await this.expandAffectedVariantIds(affectedVariantIds);

  console.log('🔁 [SALES-RECOMP] start', {
    cut: cut.toISOString(),
    affectedVariantIdsCount: affectedVariantIds.length,
    expandedVariantIdsCount: expandedVariantIds.length,
    expandedVariantIds,
  });

  // 2) Load metas for expanded variants (so we know each variant's mode + family identity)
  const metas = await this.loadVariantMetas(expandedVariantIds);
  console.log('🔁 [SALES-RECOMP] expanded variants meta', { count: metas.length });

  const metaById = new Map<number, any>(metas.map(m => [Number(m.id), m]));

  // 3) Build sibling buckets per family
  const siblingsByFamily = await this.resolveSiblingVariantsForBaseVariants(metas);

  // 4) Find affected sales invoice_items after cutoff
  const rows = await this.invoiceItemRepo
    .createQueryBuilder('ii')
    .innerJoin('ii.invoice', 'inv')
    .where('inv.date >= :cut', { cut })
    .andWhere('ii.itemVariantId IN (:...varIds)', { varIds: expandedVariantIds })
    .andWhere('inv.invoiceType IN (:...types)', { types: ['S', 'G'] })
    .select([
      'ii.id AS iiId',
      'ii.itemVariantId AS variantId',
      'inv.id AS invId',
      'inv.date AS invoiceDate',
      'inv.invoiceType AS invoiceType',
    ])
    .orderBy('inv.date', 'ASC')
    .addOrderBy('ii.id', 'ASC')
    .getRawMany<{
      iiId: number;
      variantId: number;
      invId: number;
      invoiceDate: string | Date;
      invoiceType: string;
    }>();

  console.log('🔁 [SALES-RECOMP] invoice_items found', { count: rows.length });
  if (!rows.length) return;

  // 5) Cache purchase-cost lookups by (pickedVariantId|dayKey)
  const costCache = new Map<string, any>();

  // helper: pick a box sibling to use as the purchase-cost source
  const pickBoxSource = (bucket: any, targetMeta: any) => {
    if (!bucket?.boxBySpb || bucket.boxBySpb.size === 0) return null;

    const targetSpb = Number(targetMeta?.sheetsPerBox ?? 0);

    // if target has a meaningful spb and there's an exact box match, use it
    if (targetSpb > 1) {
      const exact = bucket.boxBySpb.get(targetSpb);
      if (exact?.id) return exact;
    }

    // if only one box candidate exists, use it
    if (bucket.boxBySpb.size === 1) {
      return Array.from(bucket.boxBySpb.values())[0] ?? null;
    }

    // otherwise pick the largest spb (common case: multiple boxes, want the "real" box)
    let best: any = null;
    let bestSpb = -1;
    for (const [spb, v] of bucket.boxBySpb.entries()) {
      if (spb > bestSpb) {
        bestSpb = spb;
        best = v;
      }
    }
    return best;
  };

  for (const r of rows) {
    const iiId = Number(r.iiId);
    const targetId = Number(r.variantId);

    const target = metaById.get(targetId);
    if (!target) continue;

    const dayKey =
      typeof r.invoiceDate === 'string'
        ? String(r.invoiceDate).slice(0, 10)
        : new Date(r.invoiceDate).toISOString().slice(0, 10);

    const invDateUTC = new Date(dayKey + 'T00:00:00.000Z');

    // Find family bucket
    const nonBoxKey = this.familyKey({
      itemNameDescriptionId: target.itemNameDescriptionId ?? null,
      thicknessMm: target.thicknessMm,
      length: target.length,
      width: target.width,
      origin: target.origin ?? null,
      sheetsPerBox: target.sheetsPerBox ?? null,
      mode: 'sheet',
    });

    const bucket = siblingsByFamily.get(nonBoxKey);

    // ✅ Decide which variant to use to READ purchase costs
    // If target is box -> itself
    // If target is sheet/sqm/unit -> prefer the box sibling
    let picked = target;
    if (target.mode !== 'box') {
      const boxSource = pickBoxSource(bucket, target);
      if (boxSource?.id) picked = boxSource;
    }

    const pickedVariantId = Number(picked.id);

    // ✅ get purchase costs (cached)
    const costKey = `${pickedVariantId}|${dayKey}`;
    let costs = costCache.get(costKey);
    if (!costs) {
      costs = await this.getPurchaseAvgCostsAsOf(pickedVariantId, invDateUTC);
      costCache.set(costKey, costs);
    }

    console.log('🧾 [SALES-RECOMP] resolved purchase source', {
      iiId,
      targetId,
      targetMode: target.mode,
      dayKey,
      pickedVariantId,
      pickedMode: picked.mode,
      pickedSpb: picked.sheetsPerBox ?? null,
      candidateIdsCount: bucket?.boxBySpb?.size ?? 0,
      costs,
    });

    // ✅ IMPORTANT: write costs EXACTLY AS-IS (NO division by spb, NO sqm conversion)
    await this.invoiceItemRepo.update(iiId, {
      averageCost: costs?.averageCost ?? null,
      averageCostC: costs?.averageCostC ?? null,
      averageCostVM: costs?.averageCostVM ?? null,
      averageCostCVM: costs?.averageCostCVM ?? null,
    });
  }

  console.log('✅ [SALES-RECOMP] done');
}








// In your PurchaseInvoicesService (or wherever PurchaseInvoiceItem repo lives)
// Make sure you have this import at the top:
// import { InventoryCount } from '../inventory/count.entity';

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
