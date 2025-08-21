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
        const dateReceived = `${month}/${year}`;

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
        const dateReceived = `${month}/${year}`;

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

    if (savedInvoice.status === 'Recieved' && savedInvoice.type === 'S') {
      const invDate = new Date(savedInvoice.date);

      // ⛔️ Build a NOT-IN list so we never count the current invoice’s rows in any “previous” SUM
      const currPiiIds = (savedInvoice.items ?? []).map((it) => it.id);
      const hasCurrPiiIds = currPiiIds.length > 0;
      console.log(
        '🔒 Excluding current PurchaseInvoiceItem IDs from prior sums:',
        currPiiIds,
      );

      // Collect all description IDs for the final update
      const descIds = new Set<number>();

      for (const item of savedInvoice.items) {
        // ───────── STANDARD COST TRACK ─────────
        // load the variant (so we have its description ID)
        const variantt = await this.variantRepo.findOne({
          where: { id: item.itemVariantId },
          select: ['id', 'itemNameDescriptionId'],
        });
        if (!variantt) {
          console.error(`Variant ${item.itemVariantId} not found`);
          continue;
        }

        const vid = variantt.id;
        const descId = variantt.itemNameDescriptionId;
        descIds.add(descId);

        console.log(
          `\n[STANDARD] ► Processing PII ${item.id} (variantId=${vid}, descId=${descId}) on invoice ${savedInvoice.id}`,
        );
        console.log(`[STANDARD]   invoice date (PO):`, invDate);

        // 1) Sum prior sqm-OFR (EXCLUDING current invoice items)
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

        const { sum: rawPrev } = await qbPrev.getRawOne();
        const prevQty = Number(rawPrev) || 0;
        console.log(
          '[STANDARD]   previous quantity (excluding current invoice):',
          prevQty,
        );

        // 2) Prev avg-OFR
        const variant = await this.variantRepo.findOne({
          where: { id: item.itemVariantId },
        });
        let prevAvg = variant.averageCost;
        console.log(
          `[STANDARD]   variant.averageCost (stored) =`,
          variant.averageCost != null ? Number(variant.averageCost) : null,
        );
        if (prevAvg == null) {
          const opening = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .findOne({ where: { itemVariant: { id: variant.id } } });
          prevAvg = opening?.finalCostOfr ?? 0;
          console.log(
            '[STANDARD]   previous average from opening (fallback):',
            prevAvg,
            '| opening?.finalCostOfr=',
            opening?.finalCostOfr ?? null,
          );
        } else {
          console.log(
            '[STANDARD]   using stored previous average cost:',
            prevAvg,
          );
        }

        // 3) This PO’s sqm & unitPrice
        const poQty = Number(item.sqm);
        const poCost = Number(item.unitPrice);
        console.log('[STANDARD]   poQty:', poQty, '| poCost:', poCost);

        // 4) New blended avg-OFR
        const totalQty = prevQty + poQty;
        console.log('[STANDARD]   totalQty (prevQty + poQty):', totalQty);
        console.log(
          '[STANDARD]   blend formula: newAvg = (prevAvg*prevQty + poCost*poQty) / totalQty',
        );

        const newAvg =
          totalQty > 0
            ? (prevAvg * prevQty + poCost * poQty) / totalQty
            : poCost;

        console.log('[STANDARD]   computed newAvg:', newAvg);

        // 5) Persist STANDARD into PurchaseInvoiceItem & ItemVariant
        console.log(
          `→ Updating PurchaseInvoiceItem ${item.id} with { previousQuantity: ${prevQty}, previousAverageCost: ${prevAvg}, averageCost: ${newAvg} }`,
        );
        const piiUpdateRes = await this.itemRepo.update(item.id, {
          previousQuantity: prevQty,
          previousAverageCost: prevAvg,
          averageCost: newAvg,
        });
        console.log(`✓ PurchaseInvoiceItem ${item.id} update result:`, {
          affected: piiUpdateRes?.affected ?? 'n/a',
        });

        console.log(
          `→ Updating ItemVariant ${item.itemVariantId} with { averageCost: ${newAvg}, lastCost: ${poCost} }`,
        );
        const variantUpdateRes = await this.variantRepo.update(
          item.itemVariantId,
          {
            averageCost: newAvg,
            lastCost: poCost,
          },
        );
        console.log(`✓ ItemVariant ${item.itemVariantId} update result:`, {
          affected: variantUpdateRes?.affected ?? 'n/a',
        });

        // ───────── VM COST TRACK ─────────
        // 1) Sum prior VM sqm (use the “regular” sqm column), EXCLUDING current invoice items
        const qbPrevVm = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqm)', 'sum')
          .where('tx.itemVariantId = :vid', { vid: item.itemVariantId })
          .andWhere('tx.dateForEachInvoice < :d', { d: invDate });

        if (hasCurrPiiIds) {
          qbPrevVm.andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
            { currPiiIds },
          );
        }

        const { sum: rawPrevVm } = await qbPrevVm.getRawOne();
        const prevQtyVM = Number(rawPrevVm) || 0;

        let prevAvgVM = variant.averageCostVM;
        if (prevAvgVM == null) {
          const opening = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .findOne({ where: { itemVariant: { id: variant.id } } });
          prevAvgVM = opening?.finalCostOfr ?? 0;
        }
        const poQtyVM = Number(item.sqm);
        const poCostVM = Number((item as any).finalCost); // your VM price column

        const totalQtyVM = prevQtyVM + poQtyVM;
        const newAvgVM =
          totalQtyVM > 0
            ? (prevAvgVM * prevQtyVM + poCostVM * poQtyVM) / totalQtyVM
            : poCostVM;

        await this.itemRepo.update(item.id, {
          previousQuantityVM: prevQtyVM,
          previousAverageCostVM: prevAvgVM,
          averageCostVM: newAvgVM,
        });
        await this.variantRepo.update(item.itemVariantId, {
          averageCostVM: newAvgVM,
          lastCostVM: poCostVM,
        });

        // ───────── COLUMNS FOR ItemNameDescription ON PurchaseInvoiceItem ─────────
        // 1) Sum prior sqmofr across all variants in this description (EXCLUDING current invoice items)
        const variantIdsForDesc = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);
        console.log(`Desc ${descId} ➡ variant IDs:`, variantIdsForDesc);

        const qbPrevCGroup = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIdsForDesc })
          .andWhere('tx.dateForEachInvoice < :d', { d: invDate });

        if (hasCurrPiiIds) {
          qbPrevCGroup.andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
            { currPiiIds },
          );
        }

        const { sum: rawPrevC } = await qbPrevCGroup.getRawOne();
        const prevQtyC = Number(rawPrevC) || 0;
        console.log(
          `Desc ${descId} ➡ prevQtyC (sum sqmofr EXCLUDING current):`,
          prevQtyC,
        );

        // 2) Compute previousAverageCostC by weighting each variant’s prevAvg × prevQty (EXCLUDING current items)
        let weightedSumC = 0;
        for (const vId of variantIdsForDesc) {
          const qbPv = this.inventoryTxRepo
            .createQueryBuilder('tx')
            .select('SUM(tx.sqmofr)', 'sum')
            .where('tx.itemVariantId = :vid', { vid: vId })
            .andWhere('tx.dateForEachInvoice < :d', { d: invDate });

          if (hasCurrPiiIds) {
            qbPv.andWhere(
              '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
              { currPiiIds },
            );
          }

          const { sum: rawPv } = await qbPv.getRawOne();
          const pQty = Number(rawPv) || 0;

          let pAvg = (await this.variantRepo.findOne({ where: { id: vId } }))
            ?.averageCost;
          if (pAvg == null) {
            const op = await this.invTransRepo.manager
              .getRepository(InventoryCount)
              .findOne({ where: { itemVariant: { id: vId } } });
            pAvg = op?.finalCostOfr ?? 0;
          }

          weightedSumC += Number(pAvg) * pQty;
          console.log(
            `  Variant ${vId} ➡ pQty(excl curr): ${pQty}, pAvg: ${pAvg}, partialSum: ${Number(pAvg) * pQty}`,
          );
        }

        const prevAvgC = prevQtyC > 0 ? weightedSumC / prevQtyC : 0;
        console.log(`Desc ${descId} ➡ prevAvgC:`, prevAvgC);

        // 3) Use this PO’s contribution at desc level (just this variant’s poQty/poCost)
        const poQtyC = Number(item.sqm);
        const poCostC = Number((item as any).priceOFR);
        console.log(`Desc ${descId} ➡ poQtyC: ${poQtyC}, poCostC: ${poCostC}`);

        // 4) New blended averageCostC
        const totalQtyC = prevQtyC + poQtyC;
        const newAvgC =
          totalQtyC > 0
            ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC
            : poCostC;
        console.log(
          `Desc ${descId} ➡ totalQtyC: ${totalQtyC}, newAvgC: ${newAvgC}`,
        );

        // 5) Append C-fields to your PurchaseInvoiceItem update
        console.log(
          `Desc ${descId} ➡ updating PII ${item.id} with { previousQuantityC: ${prevQtyC}, previousAverageCostC: ${prevAvgC}, averageCostC: ${newAvgC} }`,
        );
        await this.itemRepo.update(item.id, {
          previousQuantityC: prevQtyC,
          previousAverageCostC: prevAvgC,
          averageCostC: newAvgC,
        });
      } // ← end per-item loop

      // ───────── UPDATE ItemNameDescription TABLE ─────────
      for (const descId of descIds) {
        console.log(`\n— Updating ItemNameDescription ${descId} —`);

        // 1) Gather all variant IDs under this description
        const variantIds = (
          await this.variantRepo.find({
            where: { itemNameDescriptionId: descId },
            select: ['id'],
          })
        ).map((v) => v.id);
        console.log(`Desc ${descId} ➡ variant IDs:`, variantIds);

        // 2) Sum prior sqmofr across the group (EXCLUDING current invoice items)
        const qbPrevCAll = this.inventoryTxRepo
          .createQueryBuilder('tx')
          .select('SUM(tx.sqmofr)', 'sum')
          .where('tx.itemVariantId IN (:...ids)', { ids: variantIds })
          .andWhere('tx.dateForEachInvoice < :d', { d: invDate });

        if (hasCurrPiiIds) {
          qbPrevCAll.andWhere(
            '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currPiiIds))',
            { currPiiIds },
          );
        }

        const { sum: rawPrevC2 } = await qbPrevCAll.getRawOne();
        const prevQtyC = Number(rawPrevC2) || 0;
        console.log(`Desc ${descId} ➡ prevQtyC (group, excl curr):`, prevQtyC);

        // 3) Determine previousAverageCostC by looking up the last settled description-level cost
        let prevAvgC: number;

        // Look up the most recent PII (before this invoice) where the variant belongs to this description.
        // Also exclude THIS invoice explicitly to avoid picking up our own rows.
        const lastItem = await this.itemRepo
          .createQueryBuilder('pii')
          .innerJoin('pii.invoice', 'inv')
          .innerJoin('pii.itemVariant', 'iv')
          .where('inv.status = :status', { status: 'Recieved' })
          .andWhere('inv.type = :type', { type: 'S' })
          .andWhere('inv.date < :date', { date: invDate })
          .andWhere('inv.id <> :curInvId', { curInvId: savedInvoice.id }) // ← exclude current invoice
          .andWhere('iv.itemNameDescriptionId = :descId', { descId }) // ← same description as the selected variant
          .orderBy('inv.date', 'DESC')
          .addOrderBy('pii.id', 'DESC')
          .select(['pii.previousAverageCostC']) // we want the previous avg C recorded on that row
          .getOne();

        if (lastItem?.previousAverageCostC != null) {
          prevAvgC = Number(lastItem.previousAverageCostC);
          console.log(
            `Desc ${descId} ➡ loaded prevAvgC from last invoice:`,
            prevAvgC,
          );
        } else {
          console.log(
            `Desc ${descId} ➡ no prior invoice, computing from openings (weighted)`,
          );

          // Get all variants that share this description
          const variantIds = (
            await this.variantRepo.find({
              where: { itemNameDescriptionId: descId },
              select: ['id'],
            })
          ).map((v) => v.id);

          // Weighted average from opening counts across those variants:
          const openings = await this.invTransRepo.manager
            .getRepository(InventoryCount)
            .find({
              where: { itemVariant: In(variantIds) },
              select: ['sqm', 'finalCostOfr'],
            });

          const totalOpenQty = openings.reduce(
            (sum, op) => sum + Number(op.sqm),
            0,
          );
          const weightedSum = openings.reduce(
            (sum, op) => sum + Number(op.sqm) * Number(op.finalCostOfr),
            0,
          );

          prevAvgC = totalOpenQty > 0 ? weightedSum / totalOpenQty : 0;
          console.log(
            `Desc ${descId} ➡ openings totalQty=${totalOpenQty}, weightedSum=${weightedSum}, prevAvgC=${prevAvgC}`,
          );
        }

        // 4) Sum this invoice’s contribution across variants of this description (current PO only)
        const poItemsForDesc = (savedInvoice.items ?? []).filter((it) => {
          const vDescId = (it as any)?.itemVariant?.itemNameDescriptionId;
          return vDescId === descId;
        });

        const poQtyC = poItemsForDesc.reduce(
          (sum, it) => sum + Number(it.sqm),
          0,
        );
        const poCostC =
          poItemsForDesc.reduce(
            (sum, it) => sum + Number((it as any).priceOFR) * Number(it.sqm),
            0,
          ) / (poQtyC || 1);

        console.log(`Desc ${descId} ➡ poQtyC: ${poQtyC}, poCostC: ${poCostC}`);

        // 5) Blend to get newAvgC
        const totalQtyC2 = prevQtyC + poQtyC;
        const newAvgC2 =
          totalQtyC2 > 0
            ? (prevAvgC * prevQtyC + poCostC * poQtyC) / totalQtyC2
            : poCostC;
        console.log(
          `Desc ${descId} ➡ totalQtyC: ${totalQtyC2}, newAvgC: ${newAvgC2}`,
        );

        // 6) Pick lastCostC from one of the invoice items
        const lastCostC = Number(
          poItemsForDesc[poItemsForDesc.length - 1]
            ? (poItemsForDesc[poItemsForDesc.length - 1] as any).priceOFR
            : 0,
        );
        console.log(`Desc ${descId} ➡ lastCostC: ${lastCostC}`);

        // 7) Persist to ItemNameDescription
        console.log(
          `Desc ${descId} ➡ updating ItemNameDescription with { averageCostC: ${newAvgC2}, lastCostC: ${lastCostC} }`,
        );
        await this.descRepo.update(descId, {
          averageCostC: newAvgC2,
          lastCostC: lastCostC,
        });
        console.log(`Desc ${descId} ➡ update complete`);
      }
    }
    return savedInvoice;
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

  async update(
    id: number,
    updatedData: Partial<PurchaseInvoice>,
  ): Promise<PurchaseInvoice> {
    // 1) Load the invoice with its children
    const invoice = await this.invoiceRepo.findOne({
      where: { id },
      relations: ['items', 'unitPriceRows', 'vouchers', 'vouchers.details'],
    });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);

    // ── Capture original item sqm’s ────────────────────────────────
    const originalItems = invoice.items.map((i) => ({
      id: i.id,
      variantId: i.itemVariantId,
      sqm: Number(i.sqm),
    }));
    const originalStatus = invoice.status;

    // 2) Merge & save top-level fields
    Object.assign(invoice, {
      invoiceNumber: updatedData.invoiceNumber,
      date: updatedData.date,
      expectedArrivalDate: updatedData.expectedArrivalDate,
      type: updatedData.type,
      supplierId: updatedData.supplierId,
      vatAmount: updatedData.vatAmount,
      grandAmount: updatedData.grandAmount,
      exchangeRate: updatedData.exchangeRate,
      status: updatedData.status,

      shippingLine: updatedData.shippingLine,
      etd: updatedData.etd,
      numberOfContainers: updatedData.numberOfContainers,
      blNumber: updatedData.blNumber,
      potentialCost: updatedData.potentialCost,
      shippingCost: updatedData.shippingCost,
      finalCost: updatedData.finalCost,
    });
    await this.invoiceRepo.save(invoice);

    // ── if we just flipped *out of* Recieved, subtract exactly what we previously added ──

    // 3) Remove truly deleted items by variantId, then upsert
    if (updatedData.items) {
      // a) figure out which variants / item-IDs got removed
      const existingVariantIds = invoice.items.map((i) => i.itemVariantId);
      const incomingVariantIds = updatedData.items.map((i) => i.itemVariantId);
      const toDeleteVariantIds = existingVariantIds.filter(
        (v) => !incomingVariantIds.includes(v),
      );

      // derive the exact PurchaseInvoiceItem IDs to delete
      const toDeleteItemIds = originalItems
        .filter((ori) => toDeleteVariantIds.includes(ori.variantId))
        .map((ori) => ori.id);

      if (toDeleteItemIds.length) {
        // **1) delete matching InventoryTransaction rows first**

        // now safe to delete the old InventoryTransaction rows
        await this.invTransRepo.delete({
          purchaseInvoiceItemId: In(toDeleteItemIds),
        });

        // **2) then delete the PurchaseInvoiceItem rows**
        await this.itemRepo.delete({
          invoiceId: id,
          itemVariantId: In(toDeleteVariantIds),
        });
      }

      // b) upsert remaining & new
      const toSaveItems: PurchaseInvoiceItem[] = [];
      for (const dto of updatedData.items) {
        let entity: PurchaseInvoiceItem;
        if (dto.id) {
          // explicit ID → update
          entity = await this.itemRepo.findOneBy({ id: dto.id });
          if (!entity) throw new NotFoundException(`Item ${dto.id} not found`);
          Object.assign(entity, dto);
          entity.invoiceId = id;
        } else {
          // match by invoice+variant
          entity = await this.itemRepo.findOne({
            where: { invoiceId: id, itemVariantId: dto.itemVariantId },
          });
          if (entity) {
            Object.assign(entity, dto);
            entity.invoiceId = id;
          } else {
            entity = this.itemRepo.create({ ...dto, invoiceId: id });
          }
        }
        toSaveItems.push(entity);
      }
      invoice.items = await this.itemRepo.save(toSaveItems);
    }

    // 4) Delete any unitPriceRows the client removed
    if (updatedData.unitPriceRows) {
      const existingRowIds = invoice.unitPriceRows.map((r) => r.id);
      const incomingRowIds = updatedData.unitPriceRows
        .map((r) => r.id)
        .filter((id): id is number => !!id);
      const toDeleteRowIds = existingRowIds.filter(
        (i) => !incomingRowIds.includes(i),
      );
      if (toDeleteRowIds.length) {
        await this.rowRepo.delete(toDeleteRowIds);
      }

      // Upsert remaining rows
      const toSaveRows: UnitPriceModalRow[] = [];
      for (const dto of updatedData.unitPriceRows) {
        if (dto.value && (!dto.valueOFR || dto.valueOFR === 0)) {
          dto.valueOFR = dto.value;
        }
        // same for the exchange rates
        if (dto.valueExch && (!dto.valueExchOFR || dto.valueExchOFR === 0)) {
          dto.valueExchOFR = dto.valueExch;
        }
        let entity: UnitPriceModalRow;

        if (dto.id) {
          // existing row by PK
          entity = await this.rowRepo.findOneBy({ id: dto.id });
          if (!entity) throw new NotFoundException(`Row ${dto.id} not found`);
          Object.assign(entity, dto);
          entity.invoiceId = id;
        } else if (dto.purchaseInvoiceSettingId != null) {
          // existing “template” row, match by setting Id
          entity = await this.rowRepo.findOne({
            where: {
              invoiceId: id,
              purchaseInvoiceSettingId: dto.purchaseInvoiceSettingId,
            },
          });
          if (entity) {
            Object.assign(entity, dto);
            entity.invoiceId = id;
          } else {
            entity = this.rowRepo.create({
              ...dto,
              invoiceId: id,
            });
          }
        } else {
          // brand-new ad-hoc row (no setting), force purchaseInvoiceSettingId = null
          entity = this.rowRepo.create({
            ...dto,
            invoiceId: id,
            purchaseInvoiceSettingId: null,
          });
        }

        toSaveRows.push(entity);
      }

      invoice.unitPriceRows = await this.rowRepo.save(toSaveRows);
    }

    // 5) If Received → create or update the journal voucher + details
    if (
      invoice.status === 'Recieved' &&
      ['G', 'S', 'SR'].includes(invoice.type)
    ) {
      let voucher = await this.journalVoucherRepo.findOne({
        where: { invoice: { id } },
        relations: ['details'],
      });

      const expenseAcct = await this.accountRepo.findOneBy({
        accountNumber: '6011',
      });
      if (!expenseAcct) throw new Error('GL account 6011 not found');

      let normalTotal = 0,
        ofrTotal = 0;
      invoice.items.forEach((it) => {
        if (invoice.type === 'G') ofrTotal += Number(it.totalOFR);
        else if (invoice.type === 'S') normalTotal += Number(it.totalAmount);
        else {
          normalTotal += Number(it.totalAmount);
          ofrTotal += Number(it.totalOFR);
        }
      });
      const rate = Number(invoice.exchangeRate);
      const normalLL = normalTotal * rate;
      const ofrLL = ofrTotal * rate;

      const prefix = invoice.type === 'G' ? 'PVG' : 'PV';
      const jvNumber = voucher
        ? voucher.jvNumber
        : await this.getNextPvNumber(prefix);

      let hdrDr = 0,
        hdrDrUSD = 0,
        hdrDrLL = 0,
        hdrDrOFR = 0,
        hdrDrUSDOFR = 0,
        hdrDrLLOFR = 0;
      let hdrCr = 0,
        hdrCrUSD = 0,
        hdrCrLL = 0,
        hdrCrOFR = 0,
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

        hdrCrOFR = normalTotal;
        hdrCrUSDOFR = normalTotal;
        hdrCrLLOFR = normalLL;
        hdrCr = normalTotal;
        hdrCrUSD = normalTotal;
        hdrCrLL = normalLL;
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

      const debitLine = {
        account: { id: expenseAcct.id },
        supplier: null,
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
      };
      const creditLine = {
        account: null,
        supplier: { id: invoice.supplierId },
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
      };

      if (!voucher) {
        voucher = this.journalVoucherRepo.create({
          purchaseInvoiceId: id,
          jvNumber,
          jvType: 'PV',
          date: invoice.date,
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
          details: [
            this.journalVoucherRepo.manager.create(
              JournalVoucherDetail,
              debitLine,
            ),
            this.journalVoucherRepo.manager.create(
              JournalVoucherDetail,
              creditLine,
            ),
          ],
        });
      } else {
        Object.assign(voucher, {
          account: { id: expenseAcct.id },
          supplier: { id: invoice.supplierId },
          jvNumber,
          jvType: 'PV',
          date: invoice.date,
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
        });

        if (!voucher.details || voucher.details.length !== 2) {
          voucher.details = [
            this.journalVoucherRepo.manager.create(
              JournalVoucherDetail,
              debitLine,
            ),
            this.journalVoucherRepo.manager.create(
              JournalVoucherDetail,
              creditLine,
            ),
          ];
        } else {
          Object.assign(voucher.details[0], debitLine);
          Object.assign(voucher.details[1], creditLine);
        }
      }

      await this.journalVoucherRepo.save(voucher);

      // ── 6) Reconcile inventory by **delta** + update/create transactions ───

      // ───────────── HANDLE STOCK: update ItemBatch & ItemVariant by delta ─────────────
      // ── 6) Reconcile inventory by **delta** + update/create transactions ───
      // ── 6) Reconcile inventory by **delta** + update/create transactions ───
      if (
        invoice.status === 'Recieved' &&
        ['G', 'S', 'SR'].includes(invoice.type)
      ) {
        const invoiceDate = new Date(invoice.date);
        const year = invoiceDate.getFullYear();
        const month = String(invoiceDate.getMonth() + 1).padStart(2, '0');
        const dateReceived = `${month}/${year}`;

        for (const originalItem of originalItems) {
          const stillExists = invoice.items.find(
            (item) => item.itemVariantId === originalItem.variantId,
          );

          if (!stillExists) {
            const condition = 'Clean';
            const sqm = Number(originalItem.sqm);

            let batch = await this.itemBatchRepo.findOne({
              where: {
                itemVariant: { id: originalItem.variantId },
                condition,
                dateReceived,
              },
            });

            if (batch) {
              if (invoice.type === 'S') {
                batch.in -= sqm;
                batch.inOFR -= sqm;
              } else if (invoice.type === 'G') {
                batch.inOFR -= sqm;
              } else {
                batch.in -= sqm;
                batch.inOFR -= sqm;
              }

              batch.balance =
                Number(batch.start ?? 0) +
                Number(batch.in ?? 0) -
                Number(batch.out ?? 0);
              batch.balanceOFR =
                Number(batch.startOFR ?? 0) +
                Number(batch.inOFR ?? 0) -
                Number(batch.outOFR ?? 0);

              ['in', 'inOFR', 'balance', 'balanceOFR'].forEach((key) => {
                if (isNaN(batch[key]))
                  throw new Error(`NaN in ItemBatch.${key}`);
              });

              await this.itemBatchRepo.save(batch);
            }

            const variant = await this.variantRepo.findOneBy({
              id: originalItem.variantId,
            });

            if (variant) {
              if (invoice.type === 'S') {
                variant.totalIn -= sqm;
                variant.totalInOFR -= sqm;
              } else if (invoice.type === 'G') {
                variant.totalInOFR -= sqm;
              } else {
                variant.totalIn -= sqm;
                variant.totalInOFR -= sqm;
              }

              variant.totalBalance =
                variant.totalStart + variant.totalIn - variant.totalOut;
              variant.totalBalanceOFR =
                variant.totalStartOFR +
                variant.totalInOFR -
                variant.totalOutOFR;

              await this.variantRepo.save(variant);
            }
          }
        }

        for (const item of invoice.items) {
          const condition = (item as any).condition || 'Clean';
          const newSQM = Number(item.sqm);
          const original = originalItems.find(
            (o) => o.variantId === item.itemVariantId,
          );
          const oldSQM = original ? Number(original.sqm) : 0;
          const delta = newSQM - oldSQM;

          let batch = await this.itemBatchRepo.findOne({
            where: {
              itemVariant: { id: item.itemVariantId },
              condition,
              dateReceived,
            },
            relations: ['itemVariant'],
          });
          if (delta !== 0) {
            if (!batch) {
              batch = this.itemBatchRepo.create({
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
              batch = await this.itemBatchRepo.save(batch);
            }

            if (invoice.type === 'S') {
              batch.in = Number(batch.in ?? 0) + delta;
              batch.inOFR = Number(batch.inOFR ?? 0) + delta;
            } else if (invoice.type === 'G') {
              batch.inOFR = Number(batch.inOFR ?? 0) + delta;
            } else {
              batch.in = Number(batch.in ?? 0) + delta;
              batch.inOFR = Number(batch.inOFR ?? 0) + delta;
            }

            const start = Number(batch.start ?? 0);
            const inVal = Number(batch.in ?? 0);
            const out = Number(batch.out ?? 0);
            const startOFR = Number(batch.startOFR ?? 0);
            const inOFR = Number(batch.inOFR ?? 0);
            const outOFR = Number(batch.outOFR ?? 0);

            if (
              [start, inVal, out, startOFR, inOFR, outOFR].some((v) => isNaN(v))
            ) {
              throw new Error('NaN in batch fields');
            }

            batch.balance = parseFloat((start + inVal - out).toFixed(2));
            batch.balanceOFR = parseFloat(
              (startOFR + inOFR - outOFR).toFixed(2),
            );

            ['in', 'inOFR', 'balance', 'balanceOFR'].forEach((key) => {
              if (isNaN(batch[key])) throw new Error(`NaN in ItemBatch.${key}`);
            });

            await this.itemBatchRepo.save(batch);

            const variant = await this.variantRepo.findOne({
              where: { id: item.itemVariantId },
              relations: ['batches'],
            });

            if (!variant) continue;

            let totalStart = 0,
              totalIn = 0,
              totalOut = 0,
              totalStartOFR = 0,
              totalInOFR = 0,
              totalOutOFR = 0;

            for (const b of variant.batches) {
              totalStart += Number(b.start ?? 0);
              totalIn += Number(b.in ?? 0);
              totalOut += Number(b.out ?? 0);
              totalStartOFR += Number(b.startOFR ?? 0);
              totalInOFR += Number(b.inOFR ?? 0);
              totalOutOFR += Number(b.outOFR ?? 0);
            }

            variant.totalStart = totalStart;
            variant.totalIn = totalIn;
            variant.totalOut = totalOut;
            variant.totalStartOFR = totalStartOFR;
            variant.totalInOFR = totalInOFR;
            variant.totalOutOFR = totalOutOFR;
            variant.totalBalance = parseFloat(
              (totalStart + totalIn - totalOut).toFixed(2),
            );
            variant.totalBalanceOFR = parseFloat(
              (totalStartOFR + totalInOFR - totalOutOFR).toFixed(2),
            );

            [
              'totalStart',
              'totalIn',
              'totalOut',
              'totalBalance',
              'totalStartOFR',
              'totalInOFR',
              'totalOutOFR',
              'totalBalanceOFR',
            ].forEach((key) => {
              if (isNaN(variant[key]))
                throw new Error(`NaN in ItemVariant.${key}`);
            });

            await this.variantRepo.save(variant);
          }

          let qty = Number(item.quantity);
          let sqm = Number(item.sqm);
          let qtyOfr = 0;
          let sqmOfr = 0;

          switch (invoice.type) {
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

          const existingTx = await this.inventoryTxRepo.findOne({
            where: { purchaseInvoiceItemId: item.id },
          });

          const finalCost = Number(item.finalCost);
          const finalOFR = Number(item.finalOFR);

          if (existingTx) {
            Object.assign(existingTx, {
              itemVariantId: item.itemVariantId,
              transactionType: 'purchase',
              quantity: qty,
              sqm: sqm,
              quantityofr: qtyOfr,
              sqmofr: sqmOfr,
              finalcost: isNaN(finalCost) ? 0 : finalCost,
              finalcostofr: isNaN(finalOFR) ? 0 : finalOFR,
              itemBatch: batch,
            });

            await this.inventoryTxRepo.save(existingTx);
          } else {
            const newTx = this.inventoryTxRepo.create({
              itemVariantId: item.itemVariantId,
              transactionType: 'purchase',
              quantity: qty,
              sqm: sqm,
              quantityofr: qtyOfr,
              sqmofr: sqmOfr,
              finalcost: isNaN(finalCost) ? 0 : finalCost,
              finalcostofr: isNaN(finalOFR) ? 0 : finalOFR,
              purchaseInvoiceItemId: item.id,
              invoiceItemId: null,
              itemBatch: batch,
            });

            await this.inventoryTxRepo.save(newTx);
          }
        }
      }

      // 7) Return the fresh invoice
      return this.invoiceRepo.findOne({
        where: { id },
        relations: ['items', 'unitPriceRows', 'vouchers', 'vouchers.details'],
      });
    }
  }
}
