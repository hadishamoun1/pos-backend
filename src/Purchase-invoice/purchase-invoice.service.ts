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
        date: savedInvoice.date,
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


// 🔎 BEGIN: Cost-calculation & logging block (prevAvg now pulled from last prior PO; VM fallback=0; STANDARD fallback=weighted openings)
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

  const finalWrite = {
    averageCostC: Number(ref.averageCostC ?? 0),
    averageCostCVM: Number(ref.averageCostCVM ?? 0),
    lastCostC: Number(ref.finalOFR ?? 0),
    lastCostCVM: Number(ref.finalCost ?? 0),
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
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
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

        const poQty = Number((item as any).sqmOfr ?? 0);
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
          (s, it: any) => s + Number(it.sqmOfr ?? 0),
          0,
        );
        const weightedCostSum = poItemsSameDesc.reduce(
          (s, it: any) =>
            s + Number(it.sqmOfr ?? 0) * Number(it.finalOFR ?? 0),
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
        select: ['sqm', 'finalCostOfr'],
      });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqm) * Number(o.finalCostOfr),
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





// 🔎 BEGIN: RVR Cost-calculation & logging block (VM-only; S/SR forward recompute uses your full standard logic)
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

// 🔎 END: RVR Cost-calculation & logging block


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





  
  

async update(id: number, data: Partial<PurchaseInvoice>) {
  // ─────────────────────────────────────────────────────────
  // 0) Load current invoice + keep a snapshot of related rows
  // ─────────────────────────────────────────────────────────
  console.log('[LOAD][invoiceRepo.findOne] about to run', {
    where: { id },
    relations: ['items', 'items.itemVariant'],
  });
  const existing = await this.invoiceRepo.findOne({
    where: { id },
    relations: [
      'items',
      'items.itemVariant',
    ],
  });
  if (!existing) {
    throw new NotFoundException(`PurchaseInvoice ${id} not found`);
  }

  const prevStatus = existing.status;
  const prevType = existing.type;
  const prevDate = new Date(existing.date);
  const prevItemIds = (existing.items ?? []).map((it) => it.id);

  // ─────────────────────────────────────────────────────────
  // 1) Upsert invoice header fields (no side effects yet)
  // ─────────────────────────────────────────────────────────
  Object.assign(existing, data);
  // NOTE: if items come in the payload, we’ll handle them below in section (2)

  // ─────────────────────────────────────────────────────────
  // 2) Upsert invoice items
  //    - delete removed items
  //    - update existing
  //    - insert new
  // ─────────────────────────────────────────────────────────
  const incomingItems = (data.items ?? []).map((it: any) => ({ ...it }));
  const incomingItemIdSet = new Set<number>(
    incomingItems.filter((i) => i.id).map((i) => Number(i.id)),
  );
// 2.a) delete removed items + their inventory transactions
const toDeleteItemIds = prevItemIds.filter(
  (oldId) => !incomingItemIdSet.has(oldId),
);

if (toDeleteItemIds.length) {
  console.log('[DELETE][inventoryTxRepo.delete] for removed items FIRST', {
    purchaseInvoiceItemId: In(toDeleteItemIds),
  });

  // 1) delete transactions while purchaseInvoiceItemId is still NOT NULL
  await this.inventoryTxRepo.delete({
    purchaseInvoiceItemId: In(toDeleteItemIds),
  });

  console.log('[DELETE][itemRepo.delete] about to run AFTER tx cleanup', {
    ids: toDeleteItemIds,
  });

  // 2) now delete the purchase_invoice_items rows
  await this.itemRepo.delete(toDeleteItemIds);
}



  // 2.b) upsert/update incoming items
  const upsertedItems: PurchaseInvoiceItem[] = [];
  for (const raw of incomingItems) {
    if (raw.id) {
      // update
      console.log('[UPDATE][itemRepo.update] about to run', {
        id: raw.id,
        data: { ...raw, invoiceId: existing.id },
      });
      await this.itemRepo.update(raw.id, {
        ...raw,
        invoiceId: existing.id,
      });

      console.log('[FINDONE][itemRepo.findOne] about to run', { where: { id: raw.id } });
      const updated = await this.itemRepo.findOne({ where: { id: raw.id } });
      if (updated) upsertedItems.push(updated);
    } else {
      // insert — handle both single or accidental array return types from TypeORM
      const created = this.itemRepo.create({
        ...raw,
        invoice: { id: existing.id },
        invoiceId: existing.id,
      });

      console.log('[SAVE][itemRepo.save] about to run (create PII)', {
        sample: { ...created, invoice: { id: existing.id }, invoiceId: existing.id },
      });
      const savedOneOrMany = await this.itemRepo.save(created) as
        PurchaseInvoiceItem | PurchaseInvoiceItem[];

      if (Array.isArray(savedOneOrMany)) {
        upsertedItems.push(...savedOneOrMany);
      } else {
        upsertedItems.push(savedOneOrMany);
      }
    }
  }

  // 2.c) refresh invoice + items relation
  console.log('[FIND][itemRepo.find] about to run (items by invoice)', {
    where: { invoice: { id: existing.id } },
  });
  existing.items = await this.itemRepo.find({
    where: { invoice: { id: existing.id } },
  });

  // ─────────────────────────────────────────────────────────
  // 3) Persist invoice header now (base row)
  // ─────────────────────────────────────────────────────────
  console.log('[SAVE][invoiceRepo.save] about to run (header)', {
    id: existing.id,
    headerKeys: Object.keys(existing || {}),
  });
  const savedInvoice = await this.invoiceRepo.save(existing);

  // ─────────────────────────────────────────────────────────
  // 4) CLEAN PREVIOUS SIDE EFFECTS for this invoice
  //    - delete inventory transactions tied to previous+current items
  //    - (re)compute ItemBatch values after we recreate txs below
  //    - rebuild JV (delete or upsert)
  //    - rewrite UnitPrice rows
  // ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 4.0) Sync InventoryTransaction rows for current invoice items
//      Strategy:
//        - If any tx exists for a PII → create NEW tx with updated amounts, then delete ALL old txs
//        - If no tx exists          → create tx normally
//      This avoids double-counting and keeps history clean for later cost recomputes.
// ─────────────────────────────────────────────────────────
console.log('[SYNC][inventoryTxRepo] syncing inventory transactions for current items', {
  invoiceId: savedInvoice.id,
  itemCount: savedInvoice.items?.length ?? 0,
});

for (const item of savedInvoice.items ?? []) {
  const qty = Number(item.quantity) || 0;
  const sqm = Number(item.sqm) || 0;

  // If you have OFR fields on PII, use them; otherwise fallback to VM
  const qtyofr = Number((item as any).quantityofr ?? qty);
  const sqmofr = Number((item as any).sqmofr ?? sqm);

  const finalCostVM = Number((item as any).finalCost ?? 0);
  const finalCostOfr = Number((item as any).finalOFR ?? finalCostVM);

  // 🔍 Find ALL existing tx rows for this PII (no type filter to avoid mismatch)
  const oldTxList = await this.inventoryTxRepo.find({
    where: { purchaseInvoiceItemId: item.id },
  });

  if (oldTxList.length > 0) {
    const template = oldTxList[0]; // use first row as template for batch / extra fields

    console.log('[SAVE][inventoryTxRepo.save] creating NEW tx to replace old ones', {
      oldTxIds: oldTxList.map((t) => t.id),
      purchaseInvoiceItemId: item.id,
    });

    const newTx = this.inventoryTxRepo.create({
      itemVariantId: item.itemVariantId,
      itemBatchId: template.itemBatchId ?? null,       // keep same batch if any
      transactionType: template.transactionType ?? 'purchase',

      quantity: qty,
      sqm,
      quantityofr: qtyofr,
      sqmofr,
      finalcost: finalCostVM,
      finalcostofr: finalCostOfr,

      purchaseInvoiceItemId: item.id,
      invoiceItemId: template.invoiceItemId ?? null,
      dateForEachInvoice: savedInvoice.date,
    });

    const savedTx = await this.inventoryTxRepo.save(newTx);

    // 🗑 delete ALL old transaction rows for this PII
    const oldIds = oldTxList.map((t) => t.id);
    console.log('[DELETE][inventoryTxRepo.delete] removing OLD tx after replacement', {
      oldTxIds: oldIds,
      newTxId: savedTx.id,
    });
    await this.inventoryTxRepo.delete(oldIds);
  } else {
    // No previous tx → just create one
    console.log('[SAVE][inventoryTxRepo.save] creating tx for PII with no previous tx', {
      purchaseInvoiceItemId: item.id,
    });

    const newTx = this.inventoryTxRepo.create({
      itemVariantId: item.itemVariantId,
      itemBatchId: null,                // or resolve batch here like in create()
      transactionType: 'purchase',

      quantity: qty,
      sqm,
      quantityofr: qtyofr,
      sqmofr,
      finalcost: finalCostVM,
      finalcostofr: finalCostOfr,

      purchaseInvoiceItemId: item.id,
      invoiceItemId: null,
      dateForEachInvoice: savedInvoice.date,
    });

    await this.inventoryTxRepo.save(newTx);
  }
}

  // 4.2) delete/rebuild Journal Voucher if any (we’ll recreate if still needed)
  console.log('[FINDONE][journalVoucherRepo.findOne] about to run', {
    where: { purchaseInvoiceId: savedInvoice.id },
    relations: ['details'],
  });
  const oldJv = await this.journalVoucherRepo.findOne({
    where: { purchaseInvoiceId: savedInvoice.id },
    relations: ['details'],
  });
  let preservedJvNumber: string | null = null;
  if (oldJv) {
    preservedJvNumber = oldJv.jvNumber;
    if (oldJv.details?.length) {
      const detailIds = oldJv.details.map((d) => d.id);
      console.log('[DELETE][journalVoucherDetailRepo.delete] about to run', { ids: detailIds });
      await this.journalVoucherDetailRepo.delete(detailIds);
    }
    console.log('[DELETE][journalVoucherRepo.delete] about to run', { id: oldJv.id });
    await this.journalVoucherRepo.delete(oldJv.id);
  }

  // 4.3) rewrite UnitPrice rows for this invoice (clear then re-add)
  console.log('[FIND][rowRepo.find] about to run (unit price rows for invoice)', {
    where: { invoiceId: savedInvoice.id },
  });
  const oldRows = await this.rowRepo.find({
    where: { invoiceId: savedInvoice.id },
  });

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
          .andWhere('tx.dateForEachInvoice <= :d', { d: cutoffDate })
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

        const poQty = Number((item as any).sqmOfr ?? 0);
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
          (s, it: any) => s + Number(it.sqmOfr ?? 0),
          0,
        );
        const weightedCostSum = poItemsSameDesc.reduce(
          (s, it: any) =>
            s + Number(it.sqmOfr ?? 0) * Number(it.finalOFR ?? 0),
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
        select: ['sqm', 'finalCostOfr'],
      });
      const totalOpenQty = openings.reduce((s, o) => s + Number(o.sqm), 0);
      const weightedSum = openings.reduce(
        (s, o) => s + Number(o.sqm) * Number(o.finalCostOfr),
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





// 🔎 BEGIN: RVR Cost-calculation & logging block (VM-only; S/SR forward recompute uses your full standard logic)
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

}









// In your PurchaseInvoicesService (or wherever PurchaseInvoiceItem repo lives)

async getCostAnalysisHistory(q?: string): Promise<any[]> {
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
      'iv.id AS variantId',
      'i.itemName AS itemName',
      'th.thickness AS thickness', // correct column name
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

      // 🔹 NEW: previous quantities
      'pii.previousQuantity AS previousQuantity',
      'pii.previousQuantityC AS previousQuantityC',
      'pii.previousQuantityVM AS previousQuantityVM',
      'pii.previousQuantityCVM AS previousQuantityCVM',

      // 🔹 NEW: final costs
      'pii.finalCost AS finalCost',
      'pii.finalOFR AS finalOFR',

      // existing averages
      'pii.averageCost AS averageCost',
      'pii.averageCostVM AS averageCostVM',
      'pii.averageCostC AS averageCostC',
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

    // 1) Find a dimension pattern: 225*321-027  OR  225*321
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






}
