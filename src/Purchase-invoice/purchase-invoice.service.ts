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
      const invTxs = savedInvoice.items.map((item) => {
        // grab raw values
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
            // then zero out the “normal” fields
            qty = 0;
            sqm = 0;
            break;
          case 'RVR':
            // qty, sqm stay as-is
            qtyOfr = 0;
            sqmOfr = 0;
            break;
          default:
            // fallback: treat like SR
            qtyOfr = qty;
            sqmOfr = sqm;
        }

        return this.inventoryTxRepo.create({
          itemVariantId: item.itemVariantId,
          transactionType: 'purchase',
          quantity: qty,
          sqm: sqm,
          quantityofr: qtyOfr,
          sqmofr: sqmOfr,
          finalcost: Number((item as any).finalCost ?? 0),
          finalcostofr: Number((item as any).finalOFR ?? 0),
          purchaseInvoiceItemId: item.id,
          invoiceItemId: null,
        });
      });

      await this.inventoryTxRepo.save(invTxs);
    }

    if (savedInvoice.status === 'Recieved') {
      for (const item of savedInvoice.items) {
        const condition = (item as any).condition || 'Clean';
        const dateOnlyStr = savedInvoice.date.split('T')[0];
        const dateReceived = new Date(dateOnlyStr);

        let itemBatch = await this.itemBatchRepo.findOne({
          where: {
            itemVariant: { id: item.itemVariantId },
            condition,
            dateReceived: Raw((alias) => `DATE(${alias}) = :date`, {
              date: dateOnlyStr,
            }),
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

    // 3) if type is G, S or SR → build & save a PurchaseVoucher
    if (
      savedInvoice.status === 'Recieved' &&
      (savedInvoice.type === 'G' ||
        savedInvoice.type === 'S' ||
        savedInvoice.type === 'SR')
    ) {
      // 3a) lookup expense GL 6011
      const expenseAcct = await this.accountRepo.findOne({
        where: { accountNumber: '6011' },
      });
      if (!expenseAcct) {
        throw new Error('GL account 6011 not found');
      }

      // 3b) compute base totals
      let normalTotal = 0;
      let ofrTotal = 0;

      if (savedInvoice.type === 'G') {
        // G: only OFR
        for (const row of savedInvoice.items) {
          ofrTotal += Number(row.totalOFR);
        }
      } else if (savedInvoice.type === 'S') {
        // S: only normal
        for (const row of savedInvoice.items) {
          normalTotal += Number(row.totalAmount);
        }
      } else {
        // SR
        // SR: both
        for (const row of savedInvoice.items) {
          normalTotal += Number(row.totalAmount);
          ofrTotal += Number(row.totalOFR);
        }
      }

      const rate = Number(savedInvoice.exchangeRate);
      const normalLL = normalTotal * rate;
      const ofrLL = ofrTotal * rate;

      // 3c) build pvNumber
      let prefix = 'PV';
      if (savedInvoice.type === 'G') {
        prefix = 'PVG';
      }
      // S and SR both use 'PV'
      const pvNumber = await this.getNextPvNumber(prefix);

      // 3d) decide header totals by type
      let hdrDr = 0;
      let hdrDrUSD = 0;
      let hdrDrLL = 0;
      let hdrDrOFR = 0;
      let hdrDrUSDOFR = 0;
      let hdrDrLLOFR = 0;

      let hdrCr = 0;
      let hdrCrUSD = 0;
      let hdrCrLL = 0;
      let hdrCrOFR = 0;
      let hdrCrUSDOFR = 0;
      let hdrCrLLOFR = 0;

      if (savedInvoice.type === 'G') {
        // G: debit = OFR, credit = OFR→LL
        hdrDrOFR = ofrTotal;
        hdrDrUSDOFR = ofrTotal;
        hdrDrLLOFR = ofrLL;

        hdrCrOFR = ofrTotal;
        hdrCrUSDOFR = ofrTotal;
        hdrCrLLOFR = ofrLL;
      } else if (savedInvoice.type === 'S') {
        // S: debit & credit = normal
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
        // SR: debit covers both, credit covers both
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

      // 3e) build detail rows via plain if/else
      const debitLine: any = {
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

      const creditLine: any = {
        account: null,
        supplier: { id: savedInvoice.supplierId },
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

      // 3f) create & save voucher
      const voucher = this.voucherRepo.create({
        purchaseInvoiceId: savedInvoice.id,
        date: savedInvoice.date,
        account: { id: expenseAcct.id },
        supplier: { id: savedInvoice.supplierId },
        pvNumber,
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
        details: [debitLine, creditLine],
      });

      await this.voucherRepo.save(voucher);
    }
    // ─── 4) Save unit-price rows (including the newly selected accountId) ───
    if (data.unitPriceRows?.length) {
      // first normalize any rows where valueOFR is zero but value is non-zero
      const normalized = data.unitPriceRows.map((r) => {
        const v = Number(r.value);
        const o = Number(r.valueOFR);
        const ex = Number(r.valueExch);
        const eo = Number(r.valueExchOFR);

        return {
          ...r,
          // if we have a normal charge but no OFR, copy it across
          valueOFR: v > 0 && o === 0 ? v : o,
          // same for exchange-OFR
          valueExchOFR: ex > 0 && eo === 0 ? ex : eo,
        };
      });

      const rowsToSave = normalized.map((row) =>
        this.rowRepo.create({
          invoice: { id: savedInvoice.id },
          invoiceId: savedInvoice.id,

          // if this came from a default setting it might have a settingId, otherwise null
          purchaseInvoiceSettingId: row.purchaseInvoiceSettingId ?? null,

          // snapshot fields
          chargeName: row.chargeName,
          chargeType: row.chargeType,
          value: row.value,
          valueOFR: row.valueOFR,
          currency: row.currency,
          valueExch: row.valueExch,
          valueExchOFR: row.valueExchOFR,
          addToItemCost: row.addToItemCost,
          invoiceNbTax: row.invoiceNbTax,

          // supplier relation if chosen
          supplierId: row.supplierId ?? null,

          // ← NEW: charge account relation
          accountId: row.accountId ?? null,

          shipping: row.shipping,
        }),
      );

      await this.rowRepo.save(rowsToSave);
    }

    // ─── 5) If Received → create JV header + details for each unit-price row ───
    if (savedInvoice.status === 'Recieved' && data.unitPriceRows?.length) {
      const rate = Number(savedInvoice.exchangeRate);

      // 5a) Build next JV number
      const prefix = savedInvoice.type === 'G' ? 'JVG' : 'JV';
      const last = await this.journalVoucherRepo
        .find({
          where: { jvNumber: Like(`${prefix} - %`) },
          order: { jvNumber: 'DESC' },
          take: 1,
        })
        .then((arr) => arr[0]);
      const seq = last ? parseInt(last.jvNumber.split(' - ')[1], 10) + 1 : 1;
      const jvNumber = `${prefix} - ${String(seq).padStart(5, '0')}`;

      // 5b) Prepare accumulators for header totals
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

      // 5c) Build detail lines & accumulate
      const details: JournalVoucherDetail[] = [];
      const makeDetail = (opts: Partial<JournalVoucherDetail>) =>
        this.journalVoucherDetailRepo.create({
          ...opts,
        });

      for (const row of data.unitPriceRows) {
        // 1) raw values
        let v = Number(row.value);
        let ofr = Number(row.valueOFR);
        let ex = Number(row.valueExch);
        let exO = Number(row.valueExchOFR);

        // 2) normalize OFR / ExchOFR
        if (v > 0 && ofr === 0) ofr = v;
        if (ex > 0 && exO === 0) exO = ex;

        // 3) filter by invoice.type
        if (savedInvoice.type === 'G') {
          v = 0; // only OFR matters
        } else if (savedInvoice.type === 'S') {
          ofr = v;
          exO = ex; // only normal values
        }

        // SR leaves both as-is

        // 4) decide DR/CR order
        if (v >= 0) {
          // — Debit the charge account —
          const d = makeDetail({
            accountId: row.accountId!,
            supplierId: null,
            dr: v,
            drUSD: v,
            drLL: v * rate,
            drOFR: ofr,
            drUSDOFR: ofr,
            drLLOFR: ofr * rate,
            cr: 0,
            crUSD: 0,
            crLL: 0,
            crOFR: 0,
            crUSDOFR: 0,
            crLLOFR: 0,
          });
          details.push(d);
          hdrDr += d.dr;
          hdrDrUSD += d.drUSD;
          hdrDrLL += d.drLL;
          hdrDrOFR += d.drOFR;
          hdrDrUSDOFR += d.drUSDOFR;
          hdrDrLLOFR += d.drLLOFR;

          // — Credit the supplier —
          const c = makeDetail({
            accountId: null,
            supplierId: row.supplierId!,
            dr: 0,
            drUSD: 0,
            drLL: 0,
            drOFR: 0,
            drUSDOFR: 0,
            drLLOFR: 0,
            cr: v,
            crUSD: v,
            crLL: v * rate,
            crOFR: ofr,
            crUSDOFR: ofr,
            crLLOFR: ofr * rate,
          });
          details.push(c);
          hdrCr += c.cr;
          hdrCrUSD += c.crUSD;
          hdrCrLL += c.crLL;
          hdrCrOFR += c.crOFR;
          hdrCrUSDOFR += c.crUSDOFR;
          hdrCrLLOFR += c.crLLOFR;
        } else {
          // negative: flip roles
          const aV = Math.abs(v);
          const aOfr = Math.abs(ofr);

          // — Credit the charge account —
          const c1 = makeDetail({
            accountId: row.accountId!,
            supplierId: null,
            dr: 0,
            drUSD: 0,
            drLL: 0,
            drOFR: 0,
            drUSDOFR: 0,
            drLLOFR: 0,
            cr: aV,
            crUSD: aV,
            crLL: aV * rate,
            crOFR: aOfr,
            crUSDOFR: aOfr,
            crLLOFR: aOfr * rate,
          });
          details.push(c1);
          hdrCr += c1.cr;
          hdrCrUSD += c1.crUSD;
          hdrCrLL += c1.crLL;
          hdrCrOFR += c1.crOFR;
          hdrCrUSDOFR += c1.crUSDOFR;
          hdrCrLLOFR += c1.crLLOFR;

          // — Debit the supplier —
          const d1 = makeDetail({
            accountId: null,
            supplierId: row.supplierId!,
            dr: aV,
            drUSD: aV,
            drLL: aV * rate,
            drOFR: aOfr,
            drUSDOFR: aOfr,
            drLLOFR: aOfr * rate,
            cr: 0,
            crUSD: 0,
            crLL: 0,
            crOFR: 0,
            crUSDOFR: 0,
            crLLOFR: 0,
          });
          details.push(d1);
          hdrDr += d1.dr;
          hdrDrUSD += d1.drUSD;
          hdrDrLL += d1.drLL;
          hdrDrOFR += d1.drOFR;
          hdrDrUSDOFR += d1.drUSDOFR;
          hdrDrLLOFR += d1.drLLOFR;
        }
      }

      // 5d) Create the JV header with the exact sums
      const jv = this.journalVoucherRepo.create({
        jvNumber,
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
        details, // Cascade will persist all lines
      });
      await this.journalVoucherRepo.save(jv);
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

    // 5) If Received → create or update the voucher + details
    if (
      invoice.status === 'Recieved' &&
      ['G', 'S', 'SR'].includes(invoice.type)
    ) {
      let voucher = await this.voucherRepo.findOne({
        where: { purchaseInvoiceId: id },
        relations: ['details'],
      });

      // find GL 6011
      const expenseAcct = await this.accountRepo.findOneBy({
        accountNumber: '6011',
      });
      if (!expenseAcct) throw new Error('GL account 6011 not found');

      // recompute totals
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

      // pvNumber
      const prefix = invoice.type === 'G' ? 'PVG' : 'PV';
      const pvNumber = voucher
        ? voucher.pvNumber
        : await this.getNextPvNumber(prefix);

      // DR/CR buckets
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

      // build detail DTOs
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

      // create or update
      if (!voucher) {
        voucher = this.voucherRepo.create({
          purchaseInvoiceId: id,
          account: { id: expenseAcct.id },
          supplier: { id: invoice.supplierId },
          pvNumber,
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
            this.voucherRepo.manager.create(PurchaseVoucherDetail, debitLine),
            this.voucherRepo.manager.create(PurchaseVoucherDetail, creditLine),
          ],
        });
      } else {
        Object.assign(voucher, {
          account: { id: expenseAcct.id },
          supplier: { id: invoice.supplierId },
          pvNumber,
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
            this.voucherRepo.manager.create(PurchaseVoucherDetail, debitLine),
            this.voucherRepo.manager.create(PurchaseVoucherDetail, creditLine),
          ];
        } else {
          Object.assign(voucher.details[0], debitLine);
          Object.assign(voucher.details[1], creditLine);
        }
      }
      await this.voucherRepo.save(voucher);

      // ── 6) Reconcile inventory by **delta** + update/create transactions ───

      // ───────────── HANDLE STOCK: update ItemBatch & ItemVariant by delta ─────────────
      // ───────────── HANDLE STOCK: update ItemBatch & ItemVariant by delta ─────────────
      // ── 6) Reconcile inventory by **delta** + update/create transactions ───
      if (
        invoice.status === 'Recieved' &&
        ['G', 'S', 'SR'].includes(invoice.type)
      ) {
        const dateReceived = new Date(invoice.date.toString().split('T')[0]);

        // 🔄 Revert deleted items stock
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
                dateReceived: Raw((alias) => `DATE(${alias}) = :date`, {
                  date: dateReceived.toISOString().split('T')[0],
                }),
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

          console.log(
            `🧾 ItemVariant ${item.itemVariantId} - oldSQM: ${oldSQM}, newSQM: ${newSQM}, delta: ${delta}`,
          );

          if (delta !== 0) {
            let batch = await this.itemBatchRepo.findOne({
              where: {
                itemVariant: { id: item.itemVariantId },
                condition,
                dateReceived: Raw((alias) => `DATE(${alias}) = :date`, {
                  date: dateReceived.toISOString().split('T')[0],
                }),
              },
              relations: ['itemVariant'],
            });

            if (!batch) {
              console.log(
                `📦 Creating new batch for variant ${item.itemVariantId}`,
              );
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
            }

            console.log(`📦 Before Batch Update [${item.itemVariantId}]:`, {
              in: batch.in,
              inOFR: batch.inOFR,
            });

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
              console.error(`❌ NaN detected in batch before balance calc`, {
                start,
                inVal,
                out,
                startOFR,
                inOFR,
                outOFR,
                variantId: item.itemVariantId,
              });
              throw new Error(
                'NaN detected in batch before balance calculation',
              );
            }

            batch.balance = parseFloat((start + inVal - out).toFixed(2));
            batch.balanceOFR = parseFloat(
              (startOFR + inOFR - outOFR).toFixed(2),
            );

            console.log(`📦 After Batch Update [${item.itemVariantId}]:`, {
              balance: batch.balance,
              balanceOFR: batch.balanceOFR,
            });

            await this.itemBatchRepo.save(batch);

            const variant = await this.variantRepo.findOne({
              where: { id: item.itemVariantId },
              relations: ['batches'],
            });

            if (!variant) {
              console.warn(`⚠️ Variant not found: ${item.itemVariantId}`);
              continue;
            }

            let totalStart = 0;
            let totalIn = 0;
            let totalOut = 0;
            let totalStartOFR = 0;
            let totalInOFR = 0;
            let totalOutOFR = 0;

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

            console.log(`🧠 Variant Totals Before Calculating Balance`, {
              totalStart,
              totalIn,
              totalOut,
              totalStartOFR,
              totalInOFR,
              totalOutOFR,
            });

            const totalBalance = parseFloat(
              (totalStart + totalIn - totalOut).toFixed(2),
            );
            const totalBalanceOFR = parseFloat(
              (totalStartOFR + totalInOFR - totalOutOFR).toFixed(2),
            );

            if (isNaN(totalBalance) || isNaN(totalBalanceOFR)) {
              console.error(`❌ NaN detected in variant before save`, {
                totalStart,
                totalIn,
                totalOut,
                totalBalance,
                totalStartOFR,
                totalInOFR,
                totalOutOFR,
                totalBalanceOFR,
                variantId: variant.id,
              });
              throw new Error(
                'NaN detected in ItemVariant totals calculation!',
              );
            }

            variant.totalBalance = totalBalance;
            variant.totalBalanceOFR = totalBalanceOFR;

            const isNaNCheck = [
              'totalStart',
              'totalIn',
              'totalOut',
              'totalBalance',
              'totalStartOFR',
              'totalInOFR',
              'totalOutOFR',
              'totalBalanceOFR',
            ];

            for (const key of isNaNCheck) {
              if (isNaN(variant[key])) {
                console.error(`❌ NaN detected for ${key}`, {
                  key,
                  value: variant[key],
                  variantId: variant.id,
                });
                throw new Error(
                  `NaN detected in ItemVariant.${key} before saving.`,
                );
              }
            }

            console.log(`✅ Saving updated variant ${variant.id}`, {
              totalStart: variant.totalStart,
              totalIn: variant.totalIn,
              totalOut: variant.totalOut,
              totalBalance: variant.totalBalance,
            });

            await this.variantRepo.save(variant);
          }

          // inventory transaction create and update
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

          if (existingTx) {
            // 🔄 Update it
            Object.assign(existingTx, {
              itemVariantId: item.itemVariantId,
              transactionType: 'purchase',
              quantity: qty,
              sqm: sqm,
              quantityofr: qtyOfr,
              sqmofr: sqmOfr,
              finalcost: Number((item as any).finalCost ?? 0),
              finalcostofr: Number((item as any).finalOFR ?? 0),
            });

            await this.inventoryTxRepo.save(existingTx);
          } else {
            // ➕ Create new
            const newTx = this.inventoryTxRepo.create({
              itemVariantId: item.itemVariantId,
              transactionType: 'purchase',
              quantity: qty,
              sqm: sqm,
              quantityofr: qtyOfr,
              sqmofr: sqmOfr,
              finalcost: Number((item as any).finalCost ?? 0),
              finalcostofr: Number((item as any).finalOFR ?? 0),
              purchaseInvoiceItemId: item.id,
              invoiceItemId: null,
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
