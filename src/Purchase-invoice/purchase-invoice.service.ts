import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { Account } from '../entities/account.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity.ts';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { PurchaseVoucherDetail } from '../entities/Vouchers/purchaseVoucherDetails.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

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
      const invTxs = savedInvoice.items.map((item) =>
        this.inventoryTxRepo.create({
          itemVariantId: item.itemVariantId,
          transactionType: 'purchase',
          sqm: item.sqm,
          purchaseInvoiceItemId: item.id,
          invoiceItemId: null,
        }),
      );
      await this.inventoryTxRepo.save(invTxs);
    }

    // ─── NEW: bump the variant “in” / “inOFR” and recompute balances ───
    for (const item of savedInvoice.items) {
      const variant = await this.variantRepo.findOneBy({
        id: item.itemVariantId,
      });
      if (!variant) continue;

      const sqm = Number(item.sqm);

      // Services: bump both in & inOFR
      if (savedInvoice.type === 'S') {
        variant.in += sqm;
        variant.inOFR += sqm;
      }
      // Goods: bump inOFR only
      else if (savedInvoice.type === 'G') {
        variant.inOFR += sqm;
      }
      // SR: bump in only
      else {
        variant.in += sqm;
      }

      // recompute running balances
      variant.balance = variant.start + variant.in - variant.out;
      variant.balanceOFR = variant.startOFR + variant.inOFR - variant.outOFR;

      await this.variantRepo.save(variant);
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
      const rowsToSave = data.unitPriceRows.map((row) =>
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
    if (originalStatus === 'Recieved' && invoice.status !== 'Recieved') {
      // 1) Roll back stock on each variant
      for (const { variantId, sqm } of originalItems) {
        const v = await this.variantRepo.findOneBy({ id: variantId });
        if (!v) continue;

        if (invoice.type === 'S') {
          v.in -= sqm;
          v.inOFR -= sqm;
        } else if (invoice.type === 'G') {
          v.inOFR -= sqm;
        } else {
          // SR
          v.in -= sqm;
        }

        v.balance = v.start + v.in - v.out;
        v.balanceOFR = v.startOFR + v.inOFR - v.outOFR;
        await this.variantRepo.save(v);
      }

      // 2) Delete any inventory‐transactions for this invoice
      await this.invTransRepo.delete({
        purchaseInvoiceItemId: In(originalItems.map((o) => o.id)),
      });

      // 3) Delete its PurchaseVoucher (and details)
      const oldVoucher = await this.voucherRepo.findOne({
        where: { purchaseInvoiceId: id },
      });
      if (oldVoucher) {
        await this.voucherRepo.delete(oldVoucher.id);
      }
    }

    // ── if we just flipped *into* Recieved, re-apply all sqm to stock ──
    if (originalStatus !== 'Recieved' && invoice.status === 'Recieved') {
      for (const it of invoice.items) {
        const sqm = Number(it.sqm);
        const v = await this.variantRepo.findOneBy({ id: it.itemVariantId });
        if (!v || sqm === 0) continue;

        if (invoice.type === 'S') {
          v.in += sqm;
          v.inOFR += sqm;
        } else if (invoice.type === 'G') {
          v.inOFR += sqm;
        } else {
          // SR
          v.in += sqm;
        }

        v.balance = v.start + v.in - v.out;
        v.balanceOFR = v.startOFR + v.inOFR - v.outOFR;
        await this.variantRepo.save(v);
      }
    }

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
        for (const ori of originalItems.filter((o) =>
          toDeleteItemIds.includes(o.id),
        )) {
          const variant = await this.variantRepo.findOneBy({
            id: ori.variantId,
          });
          if (!variant) continue;

          // subtract exactly what you previously added
          if (invoice.type === 'S') {
            variant.in -= ori.sqm;
            variant.inOFR -= ori.sqm;
          } else if (invoice.type === 'G') {
            variant.inOFR -= ori.sqm;
          } else {
            // SR
            variant.in -= ori.sqm;
          }

          // recompute balances
          variant.balance = variant.start + variant.in - variant.out;
          variant.balanceOFR =
            variant.startOFR + variant.inOFR - variant.outOFR;

          await this.variantRepo.save(variant);
        }

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
      if (invoice.status === 'Recieved') {
        for (const it of invoice.items) {
          const ori = originalItems.find((o) => o.id === it.id);
          const oldSqm = ori ? ori.sqm : 0;
          const newSqm = Number(it.sqm);
          const delta = newSqm - oldSqm;
          if (delta !== 0) {
            const variant = await this.variantRepo.findOneBy({
              id: it.itemVariantId,
            });
            if (variant) {
              if (invoice.type === 'S') {
                variant.in += delta;
                variant.inOFR += delta;
              } else if (invoice.type === 'G') {
                variant.inOFR += delta;
              } else {
                variant.in += delta;
              }
              variant.balance = variant.start + variant.in - variant.out;
              variant.balanceOFR =
                variant.startOFR + variant.inOFR - variant.outOFR;
              await this.variantRepo.save(variant);
            }
          }

          // update the existing transaction or create if missing
          const existingTx = await this.invTransRepo.findOneBy({
            purchaseInvoiceItemId: it.id,
          });
          if (existingTx) {
            existingTx.sqm = newSqm;
            await this.invTransRepo.save(existingTx);
          } else if (newSqm > 0) {
            const tx = this.invTransRepo.create({
              itemVariantId: it.itemVariantId,
              transactionType: 'purchase',
              sqm: newSqm,
              purchaseInvoiceItemId: it.id,
            });
            await this.invTransRepo.save(tx);
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
