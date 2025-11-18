import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { InvoiceGateway } from './invoice.gateway';
import { Settings } from '../entities/settings.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { Thickness } from 'src/entities/inventory/thickness.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-invoice/purchase-invoice-item.entity';
import { InventoryCount } from '../entities/inventory/count.entity';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepo: Repository<InvoiceItem>,

    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepo: Repository<InventoryTransaction>,

    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepo: Repository<JournalVoucher>,

    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepo: Repository<JournalVoucherDetail>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

       @InjectRepository(ItemBatch)
    private readonly itemBatchRepository: Repository<ItemBatch>,
  ) {}
  /**
   * ✅ Generate a unique Invoice Number (S25-001 or G25-001)
   */
async createInvoice(data: any): Promise<Invoice> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    console.log('🟢 Starting invoice creation');

    const setting = await this.settingsRepo.findOneBy({ isActive: true });
    if (!setting) throw new NotFoundException('Active year not found');

    const yearSuffix = setting.year.slice(-2);
    const isReturn = data.invoiceType === 'RVR';
    const isG = data.invoiceType === 'G';

    const sequencePrefix = isG ? 'G' : 'S'; // G for G, S for S/RVR
    const typesForSeq = isG ? ['G'] : ['S', 'RVR']; // separate sequences

    const lastInvoice = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .where('invoice.invoiceType IN (:...types)', { types: typesForSeq })
      .andWhere('invoice.invoiceNumber LIKE :prefix', {
        prefix: `${sequencePrefix}${yearSuffix}-%`,
      })
      .orderBy('invoice.id', 'DESC')
      .getOne();

    let newNumber = 1;
    if (lastInvoice?.invoiceNumber) {
      const parts = lastInvoice.invoiceNumber.split('-');
      newNumber = parseInt(parts[1], 10) + 1;
    }

    const invoiceNumber = `${sequencePrefix}${yearSuffix}-${String(
      newNumber,
    ).padStart(3, '0')}`;
    console.log('📄 New invoice number:', invoiceNumber);
    const docNbr = invoiceNumber;

    const invoice = this.invoiceRepository.create({
      customerId: data.customerId,
      date: data.date,
      invoiceType: data.invoiceType,
      invoiceNumber,
      documentNumber: data.documentNumber,
      branchId: data.branchId,
      currencyId: data.currencyId,
      totalWithoutVAT: data.totalWithoutVAT,
      totalVAT: data.totalVAT,
      grandTotal: data.grandTotal,
      currencyRate: data.currencyRate,
      vatPercentage: data.vatPercentage,
    });

    const savedInvoice = await queryRunner.manager.save(invoice);
    console.log('✅ Invoice saved with ID:', savedInvoice.id);

    const items = data.items.map((item, index) => {
      console.log(`📦 Preparing item[${index}]`, item);
      if (
        item.sqm === undefined ||
        item.quantity === undefined ||
        item.itemVariantId === undefined ||
        item.itemBatchId === undefined
      ) {
        console.error(`❌ Missing required field in item[${index}]`, item);
        throw new BadRequestException(
          `Missing required fields in item[${index}]`,
        );
      }

      return this.invoiceItemRepo.create({
        invoiceId: savedInvoice.id,
        itemVariantId: item.itemVariantId,
        itemBatchId: item.itemBatchId,
        sqm: item.sqm,
        unitPrice: item.unitPrice,
        totalAmount: item.totalAmount,
        vat: item.vat,
        quantity: item.quantity,
      });
    });

    const savedItems = await queryRunner.manager
      .getRepository(InvoiceItem)
      .save(items);
    console.log('✅ Saved invoice items:', savedItems.map((i) => i.id));

    // -------------- NEW: FILL COST FIELDS ON INVOICE ITEMS --------------
    // 🔧 HERE IS THE IMPORTANT FIX: use entity name strings
    const purchaseItemRepo =
      queryRunner.manager.getRepository<PurchaseInvoiceItem>('PurchaseInvoiceItem');
    const inventoryCountRepo =
      queryRunner.manager.getRepository<InventoryCount>('InventoryCount');

    const salesDate = new Date(savedInvoice.date);

    type CostBundle = {
      averageCost: number | null;
      averageCostC: number | null;
      averageCostVM: number | null;
      averageCostCVM: number | null;
      lastCost: number | null;
      lastCostC: number | null;
      lastCostVM: number | null;
      lastCostCVM: number | null;
    };

    const safeNumOrNull = (v: any): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const uniqueVariantIds = new Set<number>();
    for (const it of savedItems) {
      if (typeof it.itemVariantId === 'number') {
        uniqueVariantIds.add(it.itemVariantId);
      }
    }
    const variantIds: number[] = Array.from(uniqueVariantIds);
    console.log('🔢 Variant IDs in this invoice (for cost lookup):', variantIds);

    const variantCostCache = new Map<number, CostBundle>();

    for (const variantId of variantIds) {
      let bundle: CostBundle | null = null;

      // 1) Try last PurchaseInvoiceItem for this variant before / on invoice date
      const lastPurchaseItem = await purchaseItemRepo
        .createQueryBuilder('pi')
        .innerJoin('pi.invoice', 'pinv')
        .where('pi.itemVariantId = :variantId', { variantId })
        .andWhere('pinv.date <= :invDate', { invDate: salesDate })
        .andWhere('pinv.type IN (:...types)', { types: ['S', 'G', 'SR'] }) // ignore RVR POs
        .orderBy('pinv.date', 'DESC')
        .addOrderBy('pinv.id', 'DESC')
        .getOne();

      if (lastPurchaseItem) {
        const avg = safeNumOrNull(lastPurchaseItem.averageCost);
        const avgC = safeNumOrNull(lastPurchaseItem.averageCostC);
        const avgVM = safeNumOrNull(lastPurchaseItem.averageCostVM);
        const avgCVM = safeNumOrNull(lastPurchaseItem.averageCostCVM);
        const lc = safeNumOrNull(lastPurchaseItem.finalOFR);
        const lcvm = safeNumOrNull(lastPurchaseItem.finalCost);

        bundle = {
          averageCost: avg,
          averageCostC: avgC,
          averageCostVM: avgVM,
          averageCostCVM: avgCVM,
          lastCost: lc,
          lastCostC: null,
          lastCostVM: lcvm,
          lastCostCVM: null,
        };
      } else {
        // 2) Fallback: use latest InventoryCount (opening count) before / on invoice date
        const lastCount = await inventoryCountRepo
          .createQueryBuilder('ic')
          .where('ic.itemVariantId = :variantId', { variantId })
          .andWhere('ic.date <= :invDate', { invDate: salesDate })
          .orderBy('ic.date', 'DESC')
          .addOrderBy('ic.id', 'DESC')
          .getOne();

        if (lastCount) {
          const base = safeNumOrNull(lastCount.finalCost);
          const baseOfr = safeNumOrNull(lastCount.finalCostOfr) ?? base;

          bundle = {
            averageCost: base,
            averageCostC: baseOfr,
            averageCostVM: null,
            averageCostCVM: null,
            lastCost: base,
            lastCostC: baseOfr,
            lastCostVM: null,
            lastCostCVM: null,
          };
        }
      }

      if (!bundle) {
        bundle = {
          averageCost: null,
          averageCostC: null,
          averageCostVM: null,
          averageCostCVM: null,
          lastCost: null,
          lastCostC: null,
          lastCostVM: null,
          lastCostCVM: null,
        };
      }

      variantCostCache.set(variantId, bundle);
    }

    const itemsWithCosts = savedItems.map((item) => {
      const costs = item.itemVariantId
        ? variantCostCache.get(item.itemVariantId)
        : undefined;

      if (costs) {
        item.averageCost = costs.averageCost;
        item.averageCostC = costs.averageCostC;
        item.averageCostVM = costs.averageCostVM;
        item.averageCostCVM = costs.averageCostCVM;
        item.lastCost = costs.lastCost;
        item.lastCostC = costs.lastCostC;
        item.lastCostVM = costs.lastCostVM;
        item.lastCostCVM = costs.lastCostCVM;
      }

      return item;
    });

    await queryRunner.manager.save(InvoiceItem, itemsWithCosts);
    console.log('✅ Cost fields populated on invoice items');

    // -------------- INVENTORY TRANSACTIONS --------------
    const inventoryTransactions = savedItems.map((item) => {
      let quantity = 0;
      let sqm = 0;
      let quantityofr = 0;
      let sqmofr = 0;

      if (data.invoiceType === 'RVR') {
        quantity = -item.quantity;
        sqm = -item.sqm;
      } else if (data.invoiceType === 'G') {
        quantityofr = -item.quantity;
        sqmofr = -item.sqm;
      } else if (data.invoiceType === 'S') {
        quantity = -item.quantity;
        sqm = -item.sqm;
        quantityofr = -item.quantity;
        sqmofr = -item.sqm;
      }

      return this.inventoryTransactionRepo.create({
        transactionType: 'Sales',
        itemVariantId: item.itemVariantId,
        itemBatchId: item.itemBatchId,
        invoiceItemId: item.id,
        quantity,
        sqm,
        quantityofr,
        sqmofr,
        transactionDate: new Date(),
        dateForEachInvoice: new Date(savedInvoice.date),
        
      });
    });

    await queryRunner.manager.save(
      InventoryTransaction,
      inventoryTransactions,
    );
    console.log('✅ Inventory transactions saved');

    // -------------- UPDATE BATCH OUT/OUTOFR (or IN/INOFR for RVR) + BALANCES --------------
    const batchRepo = queryRunner.manager.getRepository(ItemBatch);
    const affectedVariantIds = new Set<number>();

    for (const item of savedItems) {
      const batch = await batchRepo.findOne({
        where: { id: item.itemBatchId },
        relations: ['itemVariant'],
      });
      if (!batch) {
        throw new NotFoundException(`ItemBatch ${item.itemBatchId} not found`);
      }

      const variantId = batch.itemVariant?.id ?? item.itemVariantId;
      if (variantId) affectedVariantIds.add(variantId);

      const qtySqm = Number(item.sqm) || 0;

      if (data.invoiceType === 'S') {
        batch.out = Number(batch.out ?? 0) + qtySqm;
        batch.outOFR = Number(batch.outOFR ?? 0) + qtySqm;
      } else if (data.invoiceType === 'G') {
        batch.outOFR = Number(batch.outOFR ?? 0) + qtySqm;
      } else if (data.invoiceType === 'RVR') {
        batch.in = Number(batch.in ?? 0) + qtySqm;
      }

      const start = Number(batch.start ?? 0);
      const inStd = Number(batch.in ?? 0);
      const outStd = Number(batch.out ?? 0);
      const startOfr = Number(batch.startOFR ?? 0);
      const inOfr = Number(batch.inOFR ?? 0);
      const outOfr = Number(batch.outOFR ?? 0);

      batch.balance = Number((start + inStd - outStd).toFixed(2));
      batch.balanceOFR = Number((startOfr + inOfr - outOfr).toFixed(2));

      const chk = [
        'in',
        'out',
        'balance',
        'inOFR',
        'outOFR',
        'balanceOFR',
      ] as const;
      for (const key of chk) {
        if (isNaN((batch as any)[key])) {
          throw new BadRequestException(
            `Cannot save NaN in ItemBatch.${key} (batchId=${batch.id})`,
          );
        }
      }

      await batchRepo.save(batch);
    }
    console.log('✅ Batches updated & balances recomputed');

    // -------------- RECOMPUTE VARIANT TOTALS FROM BATCHES --------------
    const variantRepo = queryRunner.manager.getRepository(ItemVariant);
    for (const variantId of affectedVariantIds) {
      const variant = await variantRepo.findOne({
        where: { id: variantId },
        relations: ['batches'],
      });
      if (!variant) continue;

      let totalStart = 0;
      let totalIn = 0;
      let totalOut = 0;
      let totalStartOFR = 0;
      let totalInOFR = 0;
      let totalOutOFR = 0;

      for (const b of variant.batches ?? []) {
        totalStart += Number(b.start || 0);
        totalIn += Number(b.in || 0);
        totalOut += Number(b.out || 0);
        totalStartOFR += Number(b.startOFR || 0);
        totalInOFR += Number(b.inOFR || 0);
        totalOutOFR += Number(b.outOFR || 0);
      }

      variant.totalStart = Number(totalStart.toFixed(2));
      variant.totalIn = Number(totalIn.toFixed(2));
      variant.totalOut = Number(totalOut.toFixed(2));
      variant.totalBalance = Number(
        (totalStart + totalIn - totalOut).toFixed(2),
      );

      variant.totalStartOFR = Number(totalStartOFR.toFixed(2));
      variant.totalInOFR = Number(totalInOFR.toFixed(2));
      variant.totalOutOFR = Number(totalOutOFR.toFixed(2));
      variant.totalBalanceOFR = Number(
        (totalStartOFR + totalInOFR - totalOutOFR).toFixed(2),
      );

      await variantRepo.save(variant);
    }
    console.log('✅ Variant totals recomputed');

    // -------------------- JV (unchanged) --------------------
    const jvPrefix = isG ? 'JVG' : 'JV';
    const lastJV = await this.journalVoucherRepo
      .createQueryBuilder('jv')
      .where('jv.jvNumber LIKE :prefix', {
        prefix: `${jvPrefix}${yearSuffix}-%`,
      })
      .orderBy('jv.id', 'DESC')
      .getOne();

    const jvSequence = lastJV?.jvNumber
      ? parseInt(lastJV.jvNumber.split('-')[1]) + 1
      : 1;

    const jvNumber = `${jvPrefix}${yearSuffix}-${String(
      jvSequence,
    ).padStart(3, '0')}`;
    const currencyCode = data.currencyId === 2 ? 'LL' : 'USD';
    const useVAT = data.vatPercentage > 0;
    const rate = Number(data.currencyRate);

    let salesAccNumber = '';
    let vatAccNumber = '';

    if (useVAT) {
      salesAccNumber = currencyCode === 'USD' ? '701101' : '701102';
      vatAccNumber = currencyCode === 'USD' ? '443101' : '443102';
    } else {
      salesAccNumber = '701103';
    }

    const salesAccount = await this.accountRepo.findOneBy({
      accountNumber: salesAccNumber,
    });
    if (!salesAccount)
      throw new NotFoundException(
        `Sales account ${salesAccNumber} not found`,
      );

    const vatAccount = useVAT
      ? await this.accountRepo.findOneBy({ accountNumber: vatAccNumber })
      : null;

    if (useVAT && !vatAccount && !isG) {
      throw new NotFoundException(`VAT account ${vatAccNumber} not found`);
    }

    const total = Number(data.grandTotal);
    const totalWithoutVAT = Number(data.totalWithoutVAT);
    const totalVAT = Number(data.totalVAT);
    const totalLL = total * rate;
    const totalWithoutVATLL = totalWithoutVAT * rate;
    const totalVATLL = totalVAT * rate;

    const details: JournalVoucherDetail[] = [];

    const getJVFields = (
      type: 'dr' | 'cr',
      val: number,
      valLL: number,
    ): Partial<JournalVoucherDetail> => {
      const fields: any = {
        dr: 0,
        drUSD: 0,
        drLL: 0,
        drOFR: 0,
        drUSDOFR: 0,
        drLLOFR: 0,
        cr: 0,
        crUSD: 0,
        crLL: 0,
        crOFR: 0,
        crUSDOFR: 0,
        crLLOFR: 0,
      };
      if (type === 'dr') {
        if (isG) {
          fields.drOFR = val;
          fields.drUSDOFR = val;
          fields.drLLOFR = valLL;
        } else if (isReturn) {
          fields.dr = val;
          fields.drUSD = val;
          fields.drLL = valLL;
        } else {
          fields.dr = val;
          fields.drUSD = val;
          fields.drLL = valLL;
          fields.drOFR = val;
          fields.drUSDOFR = val;
          fields.drLLOFR = valLL;
        }
      } else {
        if (isG) {
          fields.crOFR = val;
          fields.crUSDOFR = val;
          fields.crLLOFR = valLL;
        } else if (isReturn) {
          fields.cr = val;
          fields.crUSD = val;
          fields.crLL = valLL;
        } else {
          fields.cr = val;
          fields.crUSD = val;
          fields.crLL = valLL;
          fields.crOFR = val;
          fields.crUSDOFR = val;
          fields.crLLOFR = valLL;
        }
      }
      return fields;
    };

    details.push(
      this.journalVoucherDetailRepo.create({
        customerId: data.customerId,
        description: isReturn ? 'فاتورة' : 'فاتورة',
        currency: currencyCode,
        docNbr,
        ...getJVFields('dr', total, totalLL),
      }),
    );

    const salesCrAmount = isG ? totalWithoutVAT + totalVAT : totalWithoutVAT;
    const salesCrAmountLL = isG
      ? totalWithoutVATLL + totalVATLL
      : totalWithoutVATLL;

    details.push(
      this.journalVoucherDetailRepo.create({
        accountId: salesAccount.id,
        description: 'Sales Revenue',
        currency: currencyCode,
        docNbr,
        ...getJVFields('cr', salesCrAmount, salesCrAmountLL),
      }),
    );

    if (useVAT && vatAccount && !isG) {
      details.push(
        this.journalVoucherDetailRepo.create({
          accountId: vatAccount.id,
          description: 'VAT Payable',
          currency: currencyCode,
          docNbr,
          ...getJVFields('cr', totalVAT, totalVATLL),
        }),
      );
    }

    const sum = (field: keyof JournalVoucherDetail) =>
      details.reduce((acc, entry) => acc + Number(entry[field] || 0), 0);

    const journalVoucher = this.journalVoucherRepo.create({
      jvNumber,
      jvType: data.invoiceType,
      date: data.date,
      totalDr: sum('dr'),
      totalDrUSD: sum('drUSD'),
      totalDrLL: sum('drLL'),
      totalDrOFR: sum('drOFR'),
      totalDrUSDOFR: sum('drUSDOFR'),
      totalDrLLOFR: sum('drLLOFR'),
      totalCr: sum('cr'),
      totalCrUSD: sum('crUSD'),
      totalCrLL: sum('crLL'),
      totalCrOFR: sum('crOFR'),
      totalCrUSDOFR: sum('crUSDOFR'),
      totalCrLLOFR: sum('crLLOFR'),
      details,
    });

    await queryRunner.manager.save(JournalVoucher, journalVoucher);
    console.log('✅ Journal voucher saved:', jvNumber);

    await queryRunner.commitTransaction();
    console.log('🎉 Invoice creation complete');
    return savedInvoice;
  } catch (error: any) {
    console.error('❌ Invoice creation failed:', error.message);
    await queryRunner.rollbackTransaction();
    throw new BadRequestException(error.message || 'Invoice creation failed');
  } finally {
    await queryRunner.release();
  }
}







  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      relations: ['customer', 'items'],
    });
  }
async getInvoiceById(invoiceId: number): Promise<any> {
  const invoice = await this.invoiceRepository.findOne({
    where: { id: invoiceId },
    relations: [
      'customer',
      'customer.currency',
      'customer.account',
      'items',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      // 👉 load the batch if you also want batch info (not just the id)
      'items.itemBatch',
    ],
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  const cust = invoice.customer;

  return {
    // ===== Invoice (top-level) =====
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    invoiceType: invoice.invoiceType,
    documentNumber: invoice.documentNumber || null,
    totalWithoutVAT: invoice.totalWithoutVAT,
    totalVAT: invoice.totalVAT,
    grandTotal: invoice.grandTotal,
    currencyRate: invoice.currencyRate,
    vatPercentage: invoice.vatPercentage,

    // ===== Customer (flat fields for preview convenience) =====
    customerId: cust?.id ?? null,
    customerName: cust?.customerName ?? null,
    customerInvoiceType: cust?.invoiceType ?? null,
    customerAccountNumber: cust?.customerAccountNumber ?? null,
    customerAddress: cust?.address ?? null,
    customerPhone: cust?.phoneNumber ?? null,
    customerTaxNumber: cust?.financialNumber ?? null,
    customerPaymentTerms: cust?.paymentTerms ?? null,
    customerArea: cust?.area ?? null,
    customerCompanyType: cust?.companyType ?? null,
    customerVatDefault: cust?.vat ?? null,
    currencyCode: cust?.currency?.currencyCode ?? null,

    // ===== Customer (full nested object) =====
    customer: cust
      ? {
          id: cust.id,
          customerAccountNumber: cust.customerAccountNumber,
          customerName: cust.customerName,
          firstName: (cust as any).firstName ?? null,
          middleName: (cust as any).middleName ?? null,
          paymentTerms: cust.paymentTerms ?? null,
          area: cust.area ?? null,
          companyType: cust.companyType ?? null,
          address: cust.address ?? null,
          phoneNumber: cust.phoneNumber ?? null,
          financialNumber: cust.financialNumber ?? null,
          invoiceType: cust.invoiceType ?? null,
          vat: cust.vat ?? null,
          currencyId: cust.currencyId ?? cust.currency?.id ?? null,
          currency: cust.currency
            ? {
                id: cust.currency.id,
                currencyCode: cust.currency.currencyCode,
                currencyName: cust.currency.currencyName,
              }
            : null,
          account: cust.account
            ? {
                id: cust.account.id,
                accountNumber: cust.account.accountNumber,
                accountName: cust.account.accountName,
                parentNumber: cust.account.parentNumber,
                arabicAccountName: cust.account.arabicAccountName,
                accessible: cust.account.accessible,
              }
            : null,
        }
      : null,

    // ===== Items =====
    items: invoice.items.map((item) => {
      const variant = item.itemVariant;
      const thickness = variant?.thickness;
      const itemData = thickness?.item;
      const batch = (item as any).itemBatch; // only present if you kept 'items.itemBatch' in relations

      return {
        invoiceItemId: item.id,
        sqm: item.sqm,
        unitPrice: item.unitPrice,
        totalAmount: item.totalAmount,
        vat: item.vat,
        quantity: item.quantity, // overall qty (box/sheet/sqm)

        // 👉 Added: batch id exposed plainly
        itemBatchId: (item as any).itemBatchId ?? batch?.id ?? null,

        // Item details
        itemVariantId: variant?.id,
        itemName: itemData?.itemName,
        itemType: itemData?.type, // 'box' | 'sheet' | 'sqm'
        thickness: thickness?.thickness,
        length: (variant as any)?.length ?? null,
        width: (variant as any)?.width ?? null,
        origin: variant?.origin ?? null,
        sheetsPerBox: variant?.sheetsPerBox ?? null,
        totalSheets: item.quantity * (variant?.sheetsPerBox ?? 1),

        // Box/Sheet constraints
        fixBox: (variant as any)?.fixBox ?? null,
        fixLength: (variant as any)?.fixLength ?? null,
        fixWidth: (variant as any)?.fixWidth ?? null,

        // (Optional) expose batch details if helpful in the UI
        batch: batch
          ? {
              id: batch.id,
              condition: batch.condition ?? null,
              dateReceived: batch.dateReceived ?? null,
              start: batch.start ?? null,
              in: batch.in ?? null,
              out: batch.out ?? null,
              balance: batch.balance ?? null,
              startOFR: batch.startOFR ?? null,
              inOFR: batch.inOFR ?? null,
              outOFR: batch.outOFR ?? null,
              balanceOFR: batch.balanceOFR ?? null,
            }
          : null,
      };
    }),
  };
}


 async getFilteredInvoices(
  page: number,
  limit: number,
): Promise<{ data: any[]; total: number; totalPages: number }> {
  const pageNum = Number.isFinite(page)  && page  > 0 ? page  : 1;
  const take    = Number.isFinite(limit) && limit > 0 ? limit : 100;
  const skip    = (pageNum - 1) * take;

  const [invoices, total] = await this.invoiceRepository.findAndCount({
    relations: ['customer'],
    order: { id: 'DESC' },
    skip,
    take,
  });

  return {
    data: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      totalWithoutVAT: invoice.totalWithoutVAT,
      totalVAT: invoice.totalVAT,
      grandTotal: invoice.grandTotal,
      customerId: invoice.customer?.id,
      customerName: invoice.customer?.customerName,
      invoiceType: invoice.invoiceType,
    })),
    total,
    totalPages: Math.ceil(total / take),
  };
}


 

// invoices.service.ts
// invoices.service.ts (or wherever your previous methods lived)

async getBrowsingInvoices(
  customerId: number,
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // = realDescriptionId as string
) {
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.realDescription', // ok to keep; not required for grouping
    ],
    order: { date: 'DESC' },
  });

  const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const nullLast = (v: any) =>
    v == null || Number.isNaN(Number(v)) ? Number.POSITIVE_INFINITY : Number(v);
  const toTime = (d: any) => {
    const t = new Date(d as any).getTime();
    return Number.isFinite(t) ? t : -Infinity;
  };

  const rows = invoices.flatMap((inv) =>
    (inv.items || []).map((it) => {
      const variant = it.itemVariant;
      const th = variant?.thickness;
      const item = th?.item;

      // ✅ group using FK column directly
      const realId = Number((variant as any)?.realDescriptionId ?? 0);
      const real   = (variant as any)?.realDescription;

      const length =
        (variant as any)?.length ??
        (variant as any)?.dimensions?.length ??
        null;

      const width =
        (variant as any)?.width ??
        (variant as any)?.dimensions?.width ??
        null;

      // Label from relation if present; otherwise fallback
      const descriptionName = real
        ? [real.categoryName, real.subCategory, real.colorName, real.designName]
            .filter(Boolean)
            .join(' | ')
        : '(No Description)';

      return {
        realDescriptionId: realId,               // ✅ key
        invoiceDate: inv.date,
        invoiceNumber: inv.invoiceNumber,
        itemName: item?.itemName || '',
        descriptionName,
        itemSortIndex: (item as any)?.sortIndex ?? (item as any)?.sort_index ?? null,
        thickness: th?.thickness ?? '',
        thicknessSortIndex: (th as any)?.sort_index ?? (th as any)?.sortIndex ?? null,
        origin: variant?.origin ?? '',
        length,
        width,
        type: item?.type || '',
        box: item?.type === 'box' ? it.quantity : 0,
        sheet: item?.type === 'sheet' ? it.quantity : 0,
        sheetsPerBox: item?.type === 'box' ? variant?.sheetsPerBox || 0 : null,
        sqm: it.sqm,
        unitPrice: it.unitPrice,
        vat: it.vat,
        totalAmount: it.totalAmount,
        itemVariantId: variant?.id || 0,
        itemBatchId: it.itemBatch?.id || 0,
      };
    })
  );

  // Group by realDescriptionId (string keys for consistency)
  const grouped = new Map<string, any[]>();
  for (const r of rows) {
    const k = String(r.realDescriptionId ?? 0);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(r);
  }

  const cmpWithinGroup = (a: any, b: any) => {
    const aItemIdx = nullLast(a.itemSortIndex);
    const bItemIdx = nullLast(b.itemSortIndex);
    if (aItemIdx !== bItemIdx) return aItemIdx - bItemIdx;

    const nameCmp = String(a.itemName || '').localeCompare(String(b.itemName || ''));
    if (nameCmp !== 0) return nameCmp;

    const aThIdx = nullLast(a.thicknessSortIndex);
    const bThIdx = nullLast(b.thicknessSortIndex);
    if (aThIdx !== bThIdx) return aThIdx - bThIdx;

    const aTh = toNum(a.thickness);
    const bTh = toNum(b.thickness);
    if (aTh !== bTh) return aTh - bTh;

    const bt = toTime(b.invoiceDate);
    const at = toTime(a.invoiceDate);
    if (bt !== at) return bt - at;

    return String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || ''));
  };

  const buildGroup = (key: string, items: any[], page = 1) => {
    const ordered = [...items].sort(cmpWithinGroup);
    const start = (page - 1) * limitPerGroup;
    const slice = ordered.slice(start, start + limitPerGroup);

    const latestInvoiceDate = ordered.length
      ? ordered.reduce(
          (max, r) => (toTime(r.invoiceDate) > toTime(max) ? r.invoiceDate : max),
          ordered[0].invoiceDate,
        )
      : null;

    return {
      groupKey: key,
      descriptionName: items[0]?.descriptionName || '',
      items: slice,
      total: ordered.length,
      page,
      totalPages: Math.ceil(ordered.length / limitPerGroup),
      latestInvoiceDate,
    };
  };

  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return buildGroup(groupKey, items, pagePerGroup);
  }

  const groups = Array.from(grouped.entries()).map(([key, items]) =>
    buildGroup(key, items, 1),
  );
  groups.sort((A, B) => toTime(B.latestInvoiceDate) - toTime(A.latestInvoiceDate));
  return groups.map(({ latestInvoiceDate, ...rest }) => rest);
}



  


async getBrowsingInvoicesByItemBatches(
  customerId: number,
  itemBatchIds: number[],
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // realDescriptionId as string
) {
  // 1) Resolve selected batches -> their realDescriptionIds
  const batches = await this.itemBatchRepository.find({
    where: { id: In(itemBatchIds) },
    relations: [
      'itemVariant',
      'itemVariant.realDescription',          // ⬅️ switched
      'itemVariant.thickness',
      'itemVariant.thickness.item',
    ],
  });

  const realDescriptionIds = Array.from(
    new Set(
      batches
        .map(b => b.itemVariant?.realDescription?.id)
        .filter((id): id is number => !!id)
    )
  );

  if (realDescriptionIds.length === 0) {
    return groupKey
      ? {
          groupKey,
          descriptionName: '',
          items: [],
          total: 0,
          page: pagePerGroup,
          totalPages: 0,
        }
      : [];
  }

  // 2) Fetch invoices for this customer (load realDescription, not itemNameDescription)
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.realDescription',    // ⬅️ switched
    ],
    order: { date: 'DESC' },
  });

  const toMs = (d: any) => {
    const ms = Date.parse(typeof d === 'string' ? d : String(d));
    return Number.isFinite(ms) ? ms : -Infinity;
  };

  // 3) Flatten & filter (by realDescription)
  const allItems = invoices.flatMap((invoice) =>
    (invoice.items || [])
      .filter((it) => {
        const realId = it.itemVariant?.realDescription?.id ?? 0;
        return realId && realDescriptionIds.includes(realId);
      })
      .map((item) => {
        const variant = item.itemVariant;
        const th = variant?.thickness;
        const itm = th?.item;
        const real = variant?.realDescription;
        const type = itm?.type || '';

        const length =
          (variant as any)?.length ??
          (variant as any)?.dimensions?.length ??
          null;

        const width =
          (variant as any)?.width ??
          (variant as any)?.dimensions?.width ??
          null;

        // Build a nice label from real description fields
        const descriptionName = real
          ? [real.categoryName, real.subCategory, real.colorName, real.designName]
              .filter(Boolean)
              .join(' | ')
          : '(No Description)';

        return {
          // grouping identity (REAL)
          realDescriptionId: real?.id || 0,

          // fields used in UI
          invoiceDate: invoice.date,
          invoiceDateMs: toMs(invoice.date),
          invoiceNumber: invoice.invoiceNumber,
          itemName: itm?.itemName || '',
          descriptionName,
          thickness: th?.thickness ?? '',
          origin: variant?.origin ?? '',
          type,
          box: type === 'box' ? item.quantity : 0,
          sheet: type === 'sheet' ? item.quantity : 0,
          sheetsPerBox: type === 'box' ? variant?.sheetsPerBox || 0 : null,
          sqm: item.sqm,
          unitPrice: item.unitPrice,
          vat: item.vat,
          totalAmount: item.totalAmount,
          length,
          width,
          itemVariantId: variant?.id || 0,
          itemBatchId: item.itemBatch?.id || 0,
        };
      })
  );

  // 4) Group by realDescriptionId
  const grouped = new Map<string, any[]>();
  for (const row of allItems) {
    const key = String(row.realDescriptionId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  // Helper: build one group page with items sorted by date DESC
  const pageGroup = (key: string, items: any[]) => {
    const sortedByDateDesc = items
      .slice()
      .sort((a, b) => (b.invoiceDateMs ?? -Infinity) - (a.invoiceDateMs ?? -Infinity));

    const start = (pagePerGroup - 1) * limitPerGroup;
    return {
      groupKey: key,
      descriptionName: sortedByDateDesc[0]?.descriptionName || '',
      items: sortedByDateDesc.slice(start, start + limitPerGroup),
      total: sortedByDateDesc.length,
      page: pagePerGroup,
      totalPages: Math.ceil(sortedByDateDesc.length / limitPerGroup),
      latestInvoiceDate: sortedByDateDesc[0]?.invoiceDate ?? null,
      latestInvoiceMs: sortedByDateDesc[0]?.invoiceDateMs ?? -Infinity,
    };
  };

  // Single-group pagination request
  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return pageGroup(groupKey, items);
  }

  // 5) Build first page per group
  const groups = Array.from(grouped.entries()).map(([key, items]) =>
    pageGroup(key, items)
  );

  // 6) Order groups by latest item date (newest group first)
  groups.sort((A, B) => (B.latestInvoiceMs ?? -Infinity) - (A.latestInvoiceMs ?? -Infinity));

  return groups;
}





// search items 

  private toNum(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private nullLast(n: any): number {
    return n == null || Number.isNaN(Number(n)) ? Number.POSITIVE_INFINITY : Number(n);
  }

  /** Convert Arabic-Indic digits to Western so ٥.٥ becomes 5.5, ٠٢٥ => 025 */
  private normalizeArabicDigits(s: string): string {
    if (!s) return s;
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    };
    return s.replace(/[٠-٩]/g, (d) => map[d] ?? d);
  }

  /** Exact same ordering you already use (copy your function here) */
  private orderLikeItemsService(rows: any[]) {
    const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const nullLast = (n: any) =>
      n == null || Number.isNaN(Number(n)) ? Number.POSITIVE_INFINITY : Number(n);

    // 1) group by itemName
    const byItem = new Map<string, any[]>();
    for (const r of rows) {
      const key = r.itemName ?? '';
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key)!.push(r);
    }

    // items: item.sortIndex NULLS LAST, then name ASC
    const itemKeys = Array.from(byItem.keys()).sort((a, b) => {
      const aArr = byItem.get(a)!;
      const bArr = byItem.get(b)!;
      const minSortA = Math.min(...aArr.map((x) => nullLast(x.itemSortIndex)));
      const minSortB = Math.min(...bArr.map((x) => nullLast(x.itemSortIndex)));
      if (minSortA !== minSortB) return minSortA - minSortB;
      return a.localeCompare(b);
    });

    const orderedAll: any[] = [];

    for (const itemKey of itemKeys) {
      const rowsOfItem = byItem.get(itemKey)!;

      // 2) group by thickness value
      const byTh = new Map<number, any[]>();
      for (const r of rowsOfItem) {
        const th = toNum(r.thickness);
        if (!byTh.has(th)) byTh.set(th, []);
        byTh.get(th)!.push(r);
      }

      // thickness: thickness.sort_index NULLS LAST, then numeric thickness ASC
      const thKeys = Array.from(byTh.keys()).sort((ta, tb) => {
        const aArr = byTh.get(ta)!;
        const bArr = byTh.get(tb)!;
        const minSortA = Math.min(...aArr.map((x) => nullLast(x.thicknessSortIndex)));
        const minSortB = Math.min(...bArr.map((x) => nullLast(x.thicknessSortIndex)));
        if (minSortA !== minSortB) return minSortA - minSortB;
        return ta - tb;
      });

      for (const th of thKeys) {
        const rowsTh = byTh.get(th)!;

        // 3) dims vs non-dims
        const hasDims = (r: any) => toNum(r.length) > 0 && toNum(r.width) > 0;
        const dimmed = rowsTh.filter(hasDims);
        const nonDimmed = rowsTh.filter((r) => !hasDims(r) || r.type === 'sqm');

        // group dimmed by L|W
        const byDims = new Map<string, any[]>();
        for (const r of dimmed) {
          const k = `${toNum(r.length)}|${toNum(r.width)}`;
          if (!byDims.has(k)) byDims.set(k, []);
          byDims.get(k)!.push(r);
        }

        // dims order: area DESC → L DESC → W DESC
        const dimKeys = Array.from(byDims.keys()).sort((ka, kb) => {
          const [aL, aW] = ka.split('|').map(Number);
          const [bL, bW] = kb.split('|').map(Number);
          const aArea = aL * aW, bArea = bL * bW;
          if (aArea !== bArea) return bArea - aArea;
          if (aL !== bL) return bL - aL;
          return bW - aW;
        });

        // per dims group: box (SPB DESC) → sheet → sqm
        for (const dk of dimKeys) {
          const g = byDims.get(dk)!;

          const boxes = g
            .filter((x) => x.type === 'box')
            .sort(
              (a, b) =>
                (toNum(b.sheetsPerBox) || 0) - (toNum(a.sheetsPerBox) || 0) ||
                toNum(a.itemVariantId) - toNum(b.itemVariantId),
            );
          const sheets = g
            .filter((x) => x.type === 'sheet')
            .sort((a, b) => toNum(a.itemVariantId) - toNum(b.itemVariantId));
          const sqms = g.filter((x) => x.type === 'sqm');

          orderedAll.push(...boxes, ...sheets, ...sqms);
        }

        // then sqm without dims (variantId), then no-dims non-sqm
        const sqmOthers = nonDimmed
          .filter((x) => x.type === 'sqm')
          .sort((a, b) => toNum(a.itemVariantId) - toNum(b.itemVariantId));
        const noDimsNonSqm = nonDimmed.filter((x) => x.type !== 'sqm');

        orderedAll.push(...sqmOthers, ...noDimsNonSqm);
      }
    }

    return orderedAll;
  }

  /**
   * Parse the free-text query.
   * Supports:
   *  - words for name (e.g., "ابيض")
   *  - thickness: "5.5ملم" or "5ملم"
   *  - dims: "225*321" and optional box SPB "225*321-025" (=> type=box, sheetsPerBox=25)
   */
  private parseSearchQuery(qRaw: string) {
    const q = this.normalizeArabicDigits((qRaw || '').trim());
    const out: {
      nameTokens: string[];
      thickness?: number;
      dims?: { length: number; width: number; spb?: number };
      impliedType?: 'box' | 'sheet' | 'sqm';
    } = { nameTokens: [] };

    if (!q) return out;

    // thickness: e.g., "5.5ملم" or "5ملم"
    const thMatch = q.match(/(\d+(?:\.\d+)?)\s*ملم/);
    if (thMatch) {
      out.thickness = Number(thMatch[1]);
    }

    // dims: "L*W" optionally "-SPB"
    // L/W 2-4 digits, SPB 2-3 digits commonly like 025
    const dimMatch = q.match(/(\d{2,4})\s*\*\s*(\d{2,4})(?:-(\d{2,3}))?/);
    if (dimMatch) {
      const L = Number(dimMatch[1]);
      const W = Number(dimMatch[2]);
      const spb = dimMatch[3] ? Number(dimMatch[3]) : undefined;
      out.dims = { length: L, width: W, spb };
      if (spb != null) out.impliedType = 'box';
    }

    // crude tokenization for name-ish words:
    // remove recognized parts (ملم + dims) then split remaining
    let remainder = q;
    remainder = remainder.replace(/(\d+(?:\.\d+)?)\s*ملم/g, ' ');
    remainder = remainder.replace(/(\d{2,4})\s*\*\s*(\d{2,4})(?:-(\d{2,3}))?/g, ' ');
    const tokens = remainder
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    out.nameTokens = tokens;

    // Optional: infer 'sheet' if they literally type "sheet"/"شيت" etc. (not required)
    // if (/\b(sheet|شيت)\b/i.test(q)) out.impliedType = 'sheet';

    return out;
  }

  /** Whether a row matches parsed filters */
  private rowMatchesSearch(row: any, f: ReturnType<typeof this.parseSearchQuery>): boolean {
    // thickness match (allow tiny float tolerance)
    if (typeof f.thickness === 'number') {
      const rowTh = Number(row.thickness);
      if (!(Math.abs(rowTh - f.thickness) < 0.001)) return false;
    }

    // dims match
    if (f.dims) {
      const L = this.toNum(row.length);
      const W = this.toNum(row.width);
      if (!(L === f.dims.length && W === f.dims.width)) return false;

      // SPB only matters for box
      if (typeof f.dims.spb === 'number') {
        if (row.type !== 'box') return false;
        const spb = this.toNum(row.sheetsPerBox);
        if (!(spb === f.dims.spb)) return false;
      }
    }

    // implied type (from -SPB)
    if (f.impliedType) {
      if (row.type !== f.impliedType) return false;
    }

    // name tokens: must all exist in itemName OR descriptionName (case-insensitive)
    if (f.nameTokens.length) {
      const hay = `${row.itemName || ''} ${row.descriptionName || ''} ${row.origin || ''}`
        .toLowerCase();
      for (const t of f.nameTokens) {
        if (!hay.includes(t.toLowerCase())) return false;
      }
    }

    return true;
  }

  /** Build group payload (same shape as your browsing API) */
  private buildGroupPayload(
    key: string,
    items: any[],
    limitPerGroup: number,
    pagePerGroup: number,
  ) {
    const ordered = this.orderLikeItemsService(items);
    const start = (pagePerGroup - 1) * limitPerGroup;
    const slice = ordered.slice(start, start + limitPerGroup);

    return {
      groupKey: key,
      descriptionName: items[0]?.descriptionName || '',
      items: slice,
      total: ordered.length,
      page: pagePerGroup,
      totalPages: Math.ceil(ordered.length / limitPerGroup),
    };
  }

  /** MAIN: Search within the browsing for a customer */
async searchBrowsingInvoices(
  customerId: number,
  q: string,
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // realDescriptionId as string
) {
  // 1) Load same data but with realDescription (NOT itemNameDescription)
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.realDescription', // ⬅️ switched
    ],
    order: { date: 'DESC' },
  });

  // 2) Flatten to rows (now keyed by realDescription)
  const allRows = invoices.flatMap((invoice) =>
    (invoice.items || []).map((item) => {
      const variant = item.itemVariant;
      const th = variant?.thickness;
      const it = th?.item;
      const real = (variant as any)?.realDescription;
      const batch = item.itemBatch;

      const type = it?.type || '';

      const length =
        (variant as any)?.length ??
        (variant as any)?.dimensions?.length ??
        null;

      const width =
        (variant as any)?.width ??
        (variant as any)?.dimensions?.width ??
        null;

      // human label from real description
      const descriptionName = real
        ? [real.categoryName, real.subCategory, real.colorName, real.designName]
            .filter(Boolean)
            .join(' | ')
        : '(No Description)';

      return {
        // GROUPING identity (REAL)
        realDescriptionId: real?.id || 0,

        // display
        invoiceDate: invoice.date,
        invoiceNumber: invoice.invoiceNumber,
        itemName: it?.itemName || '',
        descriptionName,

        // sort signals
        itemSortIndex: (it as any)?.sortIndex ?? (it as any)?.sort_index ?? null,
        thickness: th?.thickness ?? '',
        thicknessSortIndex: (th as any)?.sort_index ?? (th as any)?.sortIndex ?? null,

        origin: variant?.origin ?? '',
        type,
        length,
        width,
        box: type === 'box' ? item.quantity : 0,
        sheet: type === 'sheet' ? item.quantity : 0,
        sheetsPerBox: type === 'box' ? variant?.sheetsPerBox || 0 : null,

        sqm: item.sqm,
        unitPrice: item.unitPrice,
        vat: item.vat,
        totalAmount: item.totalAmount,

        itemVariantId: variant?.id || 0,
        itemBatchId: batch?.id || 0,
      };
    }),
  );

  // 3) Parse the query and filter (unchanged)
  const parsed = this.parseSearchQuery(q);
  const filtered =
    parsed.nameTokens.length || parsed.thickness != null || parsed.dims != null || parsed.impliedType
      ? allRows.filter((r) => this.rowMatchesSearch(r, parsed))
      : allRows;

  // 4) Group by realDescriptionId
  const grouped = new Map<string, any[]>();
  for (const row of filtered) {
    const key = String(row.realDescriptionId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  // 5) Single-group pagination
  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return this.buildGroupPayload(groupKey, items, limitPerGroup, pagePerGroup);
  }

  // 6) Build page 1 for each group
  const groups = Array.from(grouped.entries()).map(([key, items]) =>
    this.buildGroupPayload(key, items, limitPerGroup, 1),
  );

  // 7) Order groups by Item order (sortIndex NULLS LAST → name ASC)
  const groupOrderKey = (g: any) => {
    const fallbackGroup = grouped.get(g.groupKey);
    const src = (g.items[0] ?? (fallbackGroup ? fallbackGroup[0] : undefined)) ?? {};
    const sortIdx = this.nullLast(src.itemSortIndex);
    const name = src.itemName || '';
    return { sortIdx, name };
  };

  groups.sort((A, B) => {
    const a = groupOrderKey(A);
    const b = groupOrderKey(B);
    if (a.sortIdx !== b.sortIdx) return a.sortIdx - b.sortIdx;
    return a.name.localeCompare(b.name);
  });

  return groups;
}





// search invoice api:

// invoices.service.ts (inside InvoiceService)
async searchFilteredInvoices(
  q: string | undefined,
  page: number,
  limit: number,
): Promise<{ data: any[]; total: number; totalPages: number }> {
  const pageNum = Number.isFinite(page)  && page  > 0 ? page  : 1;
  const take    = Number.isFinite(limit) && limit > 0 ? limit : 100;
  const skip    = (pageNum - 1) * take;

  const qb = this.invoiceRepository
    .createQueryBuilder('inv')
    .leftJoinAndSelect('inv.customer', 'customer')
    .orderBy('inv.id', 'DESC')
    .skip(skip)
    .take(take);

  // --- helpers ---
  const norm = (s?: string) => (s ?? '').trim();

  // Normalize "YYYY/MM/DD" or "YYYY-MM-DD" to "YYYY-MM-DD"; return null if invalid
  const toYMD = (s: string): string | null => {
    if (!s) return null;
    const t = s.replace(/\//g, '-');
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    // validate date
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  };

  const QQ = norm(q);

  if (!QQ) {
    // no query -> same as getFilteredInvoices pagination
    const [invoices, total] = await qb.getManyAndCount();
    return {
      data: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        totalWithoutVAT: invoice.totalWithoutVAT,
        totalVAT: invoice.totalVAT,
        grandTotal: invoice.grandTotal,
        customerId: invoice.customer?.id,
        customerName: invoice.customer?.customerName,
        invoiceType: invoice.invoiceType,
      })),
      total,
      totalPages: Math.ceil(total / take),
    };
  }

  // --- decide how to filter based on QQ ---
  // Date range forms:
  //   "YYYY-MM-DD..YYYY-MM-DD"
  //   "YYYY/MM/DD..YYYY/MM/DD"
  //   also allow "to" or a single "-" between dates
  const range = QQ.match(
    /(\d{4}[-/]\d{2}[-/]\d{2})\s*(?:\.\.|to|-)\s*(\d{4}[-/]\d{2}[-/]\d{2})/i
  );
  // Single date
  const single = QQ.match(/^(\d{4}[-/]\d{2}[-/]\d{2})$/);
  // NEW: digits-only => search by numeric tail after the dash (e.g., "214" → "%-214", "14" → "%-014")
  const digitsOnly = /^\d+$/.test(QQ);
  // Looks like an invoice string (has a dash, or prefix+year+dash)
  const looksLikeInvoiceNumber =
    /^[A-Za-z]?\d{2}-\d{1,}$/.test(QQ) || QQ.includes('-');

  if (range) {
    const d1 = toYMD(range[1]);
    const d2 = toYMD(range[2]);
    if (d1 && d2) {
      qb.andWhere('inv.date BETWEEN :d1 AND :d2', { d1, d2 });
    }
  } else if (single) {
    const d = toYMD(single[1]);
    if (d) qb.andWhere('inv.date = :d', { d });
  } else if (digitsOnly) {
    // e.g. "214" => "%-214", "14" => "%-014", "001" => "%-001"
    const seq = QQ.length <= 3 ? QQ.padStart(3, '0') : QQ;
    qb.andWhere('inv.invoiceNumber LIKE :tail', { tail: `%-${seq}` });
  } else if (looksLikeInvoiceNumber) {
    // MySQL: use LOWER + LIKE (no ILIKE)
    qb.andWhere('LOWER(inv.invoiceNumber) LIKE :inv', {
      inv: `%${QQ.toLowerCase()}%`,
    });
  } else {
    // Customer name tokens (AND them together), case-insensitive
    const tokens = QQ.split(/\s+/).filter(Boolean);
    tokens.forEach((t, i) => {
      qb.andWhere(`LOWER(customer.customerName) LIKE :c${i}`, {
        [`c${i}`]: `%${t.toLowerCase()}%`,
      });
    });
  }

  const [invoices, total] = await qb.getManyAndCount();

  return {
    data: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      totalWithoutVAT: invoice.totalWithoutVAT,
      totalVAT: invoice.totalVAT,
      grandTotal: invoice.grandTotal,
      customerId: invoice.customer?.id,
      customerName: invoice.customer?.customerName,
      invoiceType: invoice.invoiceType,
    })),
    total,
    totalPages: Math.ceil(total / take),
  };
}

async updateInvoice(invoiceId: number, data: any): Promise<Invoice> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  const isFiniteNum = (v: any) => typeof v === 'number' && Number.isFinite(v);
  const to2 = (n: number) => Number(Number(n || 0).toFixed(2));
  const log = (...args: any[]) => console.log(...args);

  const dbgNum = (label: string, name: string, raw: any, n: number) => {
    if (!Number.isFinite(n)) {
      console.error(`❌ NaN @ ${label}.${name} — raw:`, raw, '→ Number(raw):', n);
      throw new BadRequestException(`NaN detected in ${label}.${name}`);
    } else {
      console.log(`🟢 ${label}.${name} =`, n);
    }
  };
  const dbgObjNums = (label: string, obj: Record<string, any>, keys: string[]) => {
    for (const k of keys) {
      const n = Number(obj[k]);
      if (!Number.isFinite(n)) {
        console.error(`❌ NaN @ ${label}.${k} — raw:`, obj[k], '→ Number(raw):', n, 'full:', obj);
        throw new BadRequestException(`NaN detected in ${label}.${k}`);
      } else {
        console.log(`🟢 ${label}.${k} =`, n);
      }
    }
  };

  try {
    console.log('🟡 Starting invoice update:', invoiceId);
    if (!Array.isArray(data.items)) {
      throw new BadRequestException('`items` must be an array');
    }

    // Load existing invoice WITH items (for delete/change calc), but we will NOT save it with items later.
    const existingInvoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: ['items'],
    });
    if (!existingInvoice) throw new NotFoundException('Invoice not found');

    // quick helper repos bound to the TX
    const invItemRepo = queryRunner.manager.getRepository(InvoiceItem);
    const batchRepo   = queryRunner.manager.getRepository(ItemBatch);
    const variantRepo = queryRunner.manager.getRepository(ItemVariant);
    const invTxnRepo  = queryRunner.manager.getRepository(InventoryTransaction);
    const jvRepo      = queryRunner.manager.getRepository(JournalVoucher);
    const jvdRepo     = queryRunner.manager.getRepository(JournalVoucherDetail);

    // Debug: incoming items raw
    console.log('🧩 Raw incoming items:', data.items);

    type IncomingItem = {
      id?: number | null;
      itemVariantId: number;
      itemBatchId: number;
      sqm: number;
      unitPrice: number;
      totalAmount: number;
      vat: number;
      quantity: number;
      invoiceId?: number;
    };

    const incoming: IncomingItem[] = (data.items || []).map((x: any, idx: number) => {
      const itemVariantId = Number(x.itemVariantId);
      const itemBatchId   = Number(x.itemBatchId);
      const sqm           = Number(x.sqm);
      const unitPrice     = Number(x.unitPrice || 0);
      const totalAmount   = Number(x.totalAmount || 0);
      const vat           = Number(x.vat || 0);
      const quantity      = Number(x.quantity);
      const invId         = Number(x.invoiceId || invoiceId);

      dbgNum(`items[${idx}]`, 'itemVariantId', x.itemVariantId, itemVariantId);
      dbgNum(`items[${idx}]`, 'itemBatchId',   x.itemBatchId,   itemBatchId);
      dbgNum(`items[${idx}]`, 'sqm',           x.sqm,           sqm);
      dbgNum(`items[${idx}]`, 'unitPrice',     x.unitPrice,     unitPrice);
      dbgNum(`items[${idx}]`, 'totalAmount',   x.totalAmount,   totalAmount);
      dbgNum(`items[${idx}]`, 'vat',           x.vat,           vat);
      dbgNum(`items[${idx}]`, 'quantity',      x.quantity,      quantity);
      if (x.invoiceId != null) dbgNum(`items[${idx}]`, 'invoiceId', x.invoiceId, invId);

      return {
        id: x.id ?? null,
        itemVariantId,
        itemBatchId,
        sqm,
        unitPrice,
        totalAmount,
        vat,
        quantity,
        invoiceId: invId,
      };
    });

    const computeEffect = (invoiceType: 'S' | 'RVR' | 'G') => {
      if (invoiceType === 'RVR') return { std: +1, ofr: 0 };
      if (invoiceType === 'G')   return { std: 0,  ofr: -1 };
      return { std: -1, ofr: -1 }; // 'S'
    };
    const eff = computeEffect(data.invoiceType as 'S'|'RVR'|'G');

    const guardBatchFields = (b: ItemBatch, label = 'batch') => {
      const keys = ['in','out','balance','inOFR','outOFR','balanceOFR'] as const;
      for (const k of keys) {
        const n = Number((b as any)[k]);
        if (!Number.isFinite(n)) {
          console.error(`❌ NaN @ ${label}.${k}`, b);
          throw new BadRequestException(`Cannot save NaN to ItemBatch.${k} (batchId=${b.id})`);
        } else {
          console.log(`🟢 ${label}.${k} =`, n);
        }
      }
    };

    // ========= Pass A: figure out deleted/changed =========
    const existingItems = await invItemRepo.find({ where: { invoiceId } });
    const existingMap = new Map<number, InvoiceItem>();
    for (const it of existingItems) existingMap.set(it.id, it);

    const incomingIds = new Set<number>();
    for (const it of incoming) if (it.id) incomingIds.add(Number(it.id));

    const deletedItems = existingItems.filter(x => !incomingIds.has(x.id));
    const to2f = (n: number) => to2(n);
    const changedItems: Array<{ oldItem: InvoiceItem; newItem: IncomingItem }> = [];
    for (const inc of incoming) {
      if (!inc.id) continue;
      const old = existingMap.get(inc.id);
      if (!old) continue;
      const changed =
        Number(old.itemVariantId) !== Number(inc.itemVariantId) ||
        Number(old.itemBatchId)   !== Number(inc.itemBatchId)   ||
        to2f(Number(old.sqm))      !== to2f(Number(inc.sqm))    ||
        to2f(Number(old.quantity)) !== to2f(Number(inc.quantity))||
        to2f(Number(old.unitPrice))!== to2f(Number(inc.unitPrice))||
        to2f(Number(old.totalAmount)) !== to2f(Number(inc.totalAmount)) ||
        to2f(Number(old.vat))         !== to2f(Number(inc.vat));
      if (changed) changedItems.push({ oldItem: old, newItem: inc });
    }

    console.log('🧹 Deleted items:', deletedItems.map(d => d.id));
    console.log('♻️ Changed items:', changedItems.map(c => c.oldItem.id));

    const affectedVariantIds = new Set<number>();

    const unapplyOldItem = async (oldItem: InvoiceItem) => {
      const oldBatch = await batchRepo.findOne({
        where: { id: oldItem.itemBatchId },
        relations: ['itemVariant'],
      });
      if (!oldBatch) throw new NotFoundException(`ItemBatch ${oldItem.itemBatchId} not found while unapplying`);

      const variantId = oldBatch.itemVariant?.id ?? oldItem.itemVariantId;
      if (variantId) affectedVariantIds.add(variantId);

      const qtySqm = Number(oldItem.sqm) || 0;
      dbgNum('unapplyOldItem', 'qtySqm', oldItem.sqm, qtySqm);

      if (existingInvoice.invoiceType === 'S') {
        oldBatch.out    = to2(Number(oldBatch.out || 0) - qtySqm);
        oldBatch.outOFR = to2(Number(oldBatch.outOFR || 0) - qtySqm);
      } else if (existingInvoice.invoiceType === 'G') {
        oldBatch.outOFR = to2(Number(oldBatch.outOFR || 0) - qtySqm);
      } else if (existingInvoice.invoiceType === 'RVR') {
        oldBatch.in     = to2(Number(oldBatch.in || 0) - qtySqm);
      }

      const start   = Number(oldBatch.start || 0);
      const inStd   = Number(oldBatch.in || 0);
      const outStd  = Number(oldBatch.out || 0);
      const startO  = Number(oldBatch.startOFR || 0);
      const inO     = Number(oldBatch.inOFR || 0);
      const outO    = Number(oldBatch.outOFR || 0);
      dbgObjNums('unapplyOldItem.recalc', { start, inStd, outStd, startO, inO, outO }, ['start','inStd','outStd','startO','inO','outO']);

      oldBatch.balance    = to2(start + inStd - outStd);
      oldBatch.balanceOFR = to2(startO + inO - outO);
      guardBatchFields(oldBatch, 'unapplyOldItem.batch');
      await batchRepo.save(oldBatch);

      await invTxnRepo.delete({ invoiceItemId: oldItem.id });
    };

    // perform deletes first
    for (const del of deletedItems) {
      console.log('🗑️ Unapplying & deleting item:', del.id);
      await unapplyOldItem(del);
      await invItemRepo.delete(del.id);
    }

    // ========= Pass B: changed/new upserts + apply =========
    const upsertedIds: number[] = [];

    const applyNewItem = async (itemRow: InvoiceItem, invoiceType: 'S'|'RVR'|'G', invoiceDate: string|Date) => {
      const batch = await batchRepo.findOne({
        where: { id: itemRow.itemBatchId },
        relations: ['itemVariant'],
      });
      if (!batch) throw new NotFoundException(`ItemBatch ${itemRow.itemBatchId} not found while applying`);

      const variantId = batch.itemVariant?.id ?? itemRow.itemVariantId;
      if (variantId) affectedVariantIds.add(variantId);

      const qtySqm = Number(itemRow.sqm) || 0;
      dbgNum('applyNewItem', 'qtySqm', itemRow.sqm, qtySqm);

      if (invoiceType === 'S') {
        batch.out    = to2(Number(batch.out || 0)    + qtySqm);
        batch.outOFR = to2(Number(batch.outOFR || 0) + qtySqm);
      } else if (invoiceType === 'G') {
        batch.outOFR = to2(Number(batch.outOFR || 0) + qtySqm);
      } else { // RVR
        batch.in     = to2(Number(batch.in || 0)     + qtySqm);
      }

      const start   = Number(batch.start || 0);
      const inStd   = Number(batch.in || 0);
      const outStd  = Number(batch.out || 0);
      const startO  = Number(batch.startOFR || 0);
      const inO     = Number(batch.inOFR || 0);
      const outO    = Number(batch.outOFR || 0);
      dbgObjNums('applyNewItem.recalc', { start, inStd, outStd, startO, inO, outO }, ['start','inStd','outStd','startO','inO','outO']);

      batch.balance    = to2(start + inStd - outStd);
      batch.balanceOFR = to2(startO + inO - outO);
      guardBatchFields(batch, 'applyNewItem.batch');
      await batchRepo.save(batch);

      // Build inventory transaction snapshot
      let quantity = 0, sqm = 0, quantityofr = 0, sqmofr = 0;
      if (invoiceType === 'RVR') {
        quantity = -itemRow.quantity;
        sqm      = -itemRow.sqm;
      } else if (invoiceType === 'G') {
        quantityofr = -itemRow.quantity;
        sqmofr      = -itemRow.sqm;
      } else { // S
        quantity    = -itemRow.quantity;  sqm    = -itemRow.sqm;
        quantityofr = -itemRow.quantity;  sqmofr = -itemRow.sqm;
      }
      dbgObjNums('applyNewItem.txn', { quantity, sqm, quantityofr, sqmofr }, ['quantity','sqm','quantityofr','sqmofr']);

      const invTxn = this.inventoryTransactionRepo.create({
        transactionType: 'Sales',
        itemVariantId: itemRow.itemVariantId,
        itemBatchId:   itemRow.itemBatchId,
        invoiceItemId: itemRow.id,
        quantity, sqm,
        quantityofr, sqmofr,
        transactionDate: new Date(),
        dateForEachInvoice: new Date(invoiceDate),
      });
      await queryRunner.manager.save(InventoryTransaction, invTxn);
    };

    // 1) Changed items
    for (const ch of changedItems) {
      const upd = existingMap.get(ch.oldItem.id)!;
      upd.invoiceId     = invoiceId; // ✅ keep FK explicit
      upd.itemVariantId = ch.newItem.itemVariantId;
      upd.itemBatchId   = ch.newItem.itemBatchId;
      upd.sqm           = to2(ch.newItem.sqm);
      upd.unitPrice     = to2(ch.newItem.unitPrice);
      upd.totalAmount   = to2(ch.newItem.totalAmount);
      upd.vat           = to2(ch.newItem.vat);
      upd.quantity      = to2(ch.newItem.quantity);

      dbgObjNums(`updateItem[${upd.id}]`, {
        sqm: upd.sqm, unitPrice: upd.unitPrice, totalAmount: upd.totalAmount,
        vat: upd.vat, quantity: upd.quantity
      }, ['sqm','unitPrice','totalAmount','vat','quantity']);

      const saved = await invItemRepo.save(upd);
      upsertedIds.push(saved.id);

      // sanity hard-set (should be redundant)
      await invItemRepo.update(saved.id, { invoiceId });

      // double-check row
      const rawCheck = await queryRunner.manager.query(
        `SELECT id, invoiceId FROM invoice_items WHERE id = ?`,
        [saved.id],
      );
      console.log('🔎 RAW check (update path):', rawCheck);

      await applyNewItem(saved, data.invoiceType, data.date);
    }

    // 2) New items
    const newItems = incoming.filter(x => !x.id);
    for (const ni of newItems) {
      const row = this.invoiceItemRepo.create({
        invoiceId,                                     // ✅ explicit
        itemVariantId: ni.itemVariantId,
        itemBatchId:   ni.itemBatchId,
        sqm:           to2(ni.sqm),
        unitPrice:     to2(ni.unitPrice),
        totalAmount:   to2(ni.totalAmount),
        vat:           to2(ni.vat),
        quantity:      to2(ni.quantity),
      });

      dbgObjNums('insertItem', {
        sqm: row.sqm, unitPrice: row.unitPrice, totalAmount: row.totalAmount,
        vat: row.vat, quantity: row.quantity
      }, ['sqm','unitPrice','totalAmount','vat','quantity']);

      const saved = await invItemRepo.save(row);
      console.log(`✅ inserted item ${saved.id} saved with invoiceId=`, saved.invoiceId);
      upsertedIds.push(saved.id);

      // force + verify
      await invItemRepo.update(saved.id, { invoiceId }); // defensive set
      const rawCheck = await queryRunner.manager.query(
        `SELECT id, invoiceId FROM invoice_items WHERE id = ?`,
        [saved.id],
      );
      console.log('🔎 RAW check (invoiceId camelCase):', rawCheck);
      console.log(`🟢 Verified item ${saved.id} invoiceId (entity)=`, saved.invoiceId);

      await applyNewItem(saved, data.invoiceType, data.date);
    }

    // ===== Header update =====
    dbgObjNums('header.incoming', {
      totalWithoutVAT: data.totalWithoutVAT,
      totalVAT: data.totalVAT,
      grandTotal: data.grandTotal,
      currencyRate: data.currencyRate,
      vatPercentage: data.vatPercentage
    }, ['totalWithoutVAT','totalVAT','grandTotal','currencyRate','vatPercentage']);

    // ⚠️ Prevent TypeORM from trying to sync children:
    if ((existingInvoice as any).items) {
      console.log('🧼 Removing items array from invoice entity before save (prevent FK side-effects)');
      delete (existingInvoice as any).items;
    }

    existingInvoice.customerId      = data.customerId;
    existingInvoice.date            = data.date;
    existingInvoice.invoiceType     = data.invoiceType;
    existingInvoice.documentNumber  = data.documentNumber;
    existingInvoice.branchId        = data.branchId;
    existingInvoice.currencyId      = data.currencyId;
    existingInvoice.totalWithoutVAT = to2(data.totalWithoutVAT);
    existingInvoice.totalVAT        = to2(data.totalVAT);
    existingInvoice.grandTotal      = to2(data.grandTotal);
    existingInvoice.currencyRate    = to2(data.currencyRate);
    existingInvoice.vatPercentage   = to2(data.vatPercentage);

    dbgObjNums('header.persist', {
      totalWithoutVAT: existingInvoice.totalWithoutVAT,
      totalVAT: existingInvoice.totalVAT,
      grandTotal: existingInvoice.grandTotal,
      currencyRate: existingInvoice.currencyRate,
      vatPercentage: existingInvoice.vatPercentage
    }, ['totalWithoutVAT','totalVAT','grandTotal','currencyRate','vatPercentage']);

    const savedInvoice = await queryRunner.manager.save(Invoice, existingInvoice);
    console.log('✅ Invoice header updated:', savedInvoice.id);

    // Post-header sanity: see if any rows for this invoice suddenly lost FK
    const nullsAfterHeader = await queryRunner.manager.query(
      `SELECT id, invoiceId FROM invoice_items WHERE invoiceId IS NULL OR invoiceId = 0`
    );
    if (nullsAfterHeader.length) {
      console.warn('⚠️ Found NULL/0 invoiceId rows AFTER header save:', nullsAfterHeader);
    }

    // ===== Variant totals recompute (unchanged from your code) =====
    for (const variantId of new Set(affectedVariantIds)) {
      const variant = await variantRepo.findOne({ where: { id: variantId }, relations: ['batches'] });
      if (!variant) continue;

      let totalStart = 0, totalIn = 0, totalOut = 0;
      let totalStartOFR = 0, totalInOFR = 0, totalOutOFR = 0;
      for (const b of variant.batches ?? []) {
        totalStart   += Number(b.start || 0);
        totalIn      += Number(b.in || 0);
        totalOut     += Number(b.out || 0);
        totalStartOFR+= Number(b.startOFR || 0);
        totalInOFR   += Number(b.inOFR || 0);
        totalOutOFR  += Number(b.outOFR || 0);
      }
      dbgObjNums(`variant[${variantId}].totals`, {
        totalStart, totalIn, totalOut, totalStartOFR, totalInOFR, totalOutOFR
      }, ['totalStart','totalIn','totalOut','totalStartOFR','totalInOFR','totalOutOFR']);

      variant.totalStart       = to2(totalStart);
      variant.totalIn          = to2(totalIn);
      variant.totalOut         = to2(totalOut);
      variant.totalBalance     = to2(totalStart + totalIn - totalOut);
      variant.totalStartOFR    = to2(totalStartOFR);
      variant.totalInOFR       = to2(totalInOFR);
      variant.totalOutOFR      = to2(totalOutOFR);
      variant.totalBalanceOFR  = to2(totalStartOFR + totalInOFR - totalOutOFR);

      dbgObjNums(`variant[${variantId}].persist`, {
        totalStart: variant.totalStart,
        totalIn: variant.totalIn,
        totalOut: variant.totalOut,
        totalBalance: variant.totalBalance,
        totalStartOFR: variant.totalStartOFR,
        totalInOFR: variant.totalInOFR,
        totalOutOFR: variant.totalOutOFR,
        totalBalanceOFR: variant.totalBalanceOFR
      }, ['totalStart','totalIn','totalOut','totalBalance','totalStartOFR','totalInOFR','totalOutOFR','totalBalanceOFR']);

      await variantRepo.save(variant);
    }
    console.log('✅ Variant totals recomputed');

    // ===== JV rebuild (unchanged except extra small logs) =====
    const jvType = savedInvoice.invoiceType;
    const docNbr = savedInvoice.invoiceNumber;
    const isG    = jvType === 'G';
    const isReturn = jvType === 'RVR';

    console.log('🧾 JV rebuild start for doc:', docNbr, 'type:', jvType);

    let jvToUpdate = await jvRepo.findOne({ where: { jvType, date: savedInvoice.date as any }, relations: ['details'] });
    if (!jvToUpdate) {
      jvToUpdate = await jvRepo
        .createQueryBuilder('jv')
        .leftJoinAndSelect('jv.details', 'detail')
        .where('detail.docNbr = :doc', { doc: docNbr })
        .orderBy('jv.id', 'DESC')
        .getOne();
    }

    let jvNumber: string | null = jvToUpdate?.jvNumber ?? null;
    if (!jvNumber) {
      const setting = await this.settingsRepo.findOneBy({ isActive: true });
      if (!setting) throw new NotFoundException('Active year not found');
      const yearSuffix = setting.year.slice(-2);
      const jvPrefix = isG ? 'JVG' : 'JV';
      const lastJV = await this.journalVoucherRepo
        .createQueryBuilder('jv')
        .where('jv.jvNumber LIKE :prefix', { prefix: `${jvPrefix}${yearSuffix}-%` })
        .orderBy('jv.id', 'DESC')
        .getOne();
      const jvSequence = lastJV?.jvNumber ? parseInt(lastJV.jvNumber.split('-')[1]) + 1 : 1;
      jvNumber = `${jvPrefix}${yearSuffix}-${String(jvSequence).padStart(3, '0')}`;
    }

    const currencyCode = data.currencyId === 2 ? 'LL' : 'USD';
    const useVAT = Number(data.vatPercentage) > 0;
    const rate = Number(data.currencyRate);
    dbgNum('jv.inputs', 'rate', rate, rate);

    const total            = to2(data.grandTotal);
    const totalWithoutVAT  = to2(data.totalWithoutVAT);
    const totalVAT         = to2(data.totalVAT);
    const totalLL          = to2(total * rate);
    const totalWithoutVATLL= to2(totalWithoutVAT * rate);
    const totalVATLL       = to2(totalVAT * rate);

    dbgObjNums('jv.computed', {
      total, totalWithoutVAT, totalVAT, totalLL, totalWithoutVATLL, totalVATLL
    }, ['total','totalWithoutVAT','totalVAT','totalLL','totalWithoutVATLL','totalVATLL']);

    let salesAccNumber = '';
    let vatAccNumber = '';
    if (useVAT) {
      salesAccNumber = currencyCode === 'USD' ? '701101' : '701102';
      vatAccNumber   = currencyCode === 'USD' ? '443101' : '443102';
    } else {
      salesAccNumber = '701103';
    }
    const salesAccount = await this.accountRepo.findOneBy({ accountNumber: salesAccNumber });
    if (!salesAccount) throw new NotFoundException(`Sales account ${salesAccNumber} not found`);
    const vatAccount = useVAT ? await this.accountRepo.findOneBy({ accountNumber: vatAccNumber }) : null;
    if (useVAT && vatAccount == null && !isG) {
      throw new NotFoundException(`VAT account ${vatAccNumber} not found`);
    }

    const jvFields = (type: 'dr' | 'cr', val: number, valLL: number): Partial<JournalVoucherDetail> => {
      const f: any = {
        dr: 0, drUSD: 0, drLL: 0, drOFR: 0, drUSDOFR: 0, drLLOFR: 0,
        cr: 0, crUSD: 0, crLL: 0, crOFR: 0, crUSDOFR: 0, crLLOFR: 0,
      };
      if (type === 'dr') {
        if (isG) { f.drOFR = val; f.drUSDOFR = val; f.drLLOFR = valLL; }
        else if (isReturn) { f.dr = val; f.drUSD = val; f.drLL = valLL; }
        else { f.dr = val; f.drUSD = val; f.drLL = valLL; f.drOFR = val; f.drUSDOFR = val; f.drLLOFR = valLL; }
      } else {
        if (isG) { f.crOFR = val; f.crUSDOFR = val; f.crLLOFR = valLL; }
        else if (isReturn) { f.cr = val; f.crUSD = val; f.crLL = valLL; }
        else { f.cr = val; f.crUSD = val; f.crLL = valLL; f.crOFR = val; f.crUSDOFR = val; f.crLLOFR = valLL; }
      }
      return f;
    };

    const details: JournalVoucherDetail[] = [];
    details.push(this.journalVoucherDetailRepo.create({
      customerId: data.customerId,
      description: isReturn ? 'فاتورة' : 'فاتورة',
      currency: currencyCode,
      docNbr,
      ...jvFields('dr', total, totalLL),
    }));
    const salesCrAmount   = isG ? totalWithoutVAT + totalVAT : totalWithoutVAT;
    const salesCrAmountLL = isG ? totalWithoutVATLL + totalVATLL : totalWithoutVATLL;
    details.push(this.journalVoucherDetailRepo.create({
      accountId: salesAccount.id,
      description: 'Sales Revenue',
      currency: currencyCode,
      docNbr,
      ...jvFields('cr', salesCrAmount, salesCrAmountLL),
    }));
    if (useVAT && vatAccount && !isG) {
      details.push(this.journalVoucherDetailRepo.create({
        accountId: vatAccount.id,
        description: 'VAT Payable',
        currency: currencyCode,
        docNbr,
        ...jvFields('cr', totalVAT, totalVATLL),
      }));
    }

    const sum = (field: keyof JournalVoucherDetail) =>
      details.reduce((acc, entry) => acc + Number(entry[field] || 0), 0);

    dbgObjNums('jv.totals', {
      totalDr: sum('dr'),
      totalDrUSD: sum('drUSD'),
      totalDrLL: sum('drLL'),
      totalDrOFR: sum('drOFR'),
      totalDrUSDOFR: sum('drUSDOFR'),
      totalDrLLOFR: sum('drLLOFR'),
      totalCr: sum('cr'),
      totalCrLL: sum('crLL'),
      totalCrOFR: sum('crOFR'),
      totalCrUSDOFR: sum('crUSDOFR'),
      totalCrLLOFR: sum('crLLOFR'),
    }, [
      'totalDr','totalDrUSD','totalDrLL','totalDrOFR','totalDrUSDOFR','totalDrLLOFR',
      'totalCr','totalCrLL','totalCrOFR','totalCrUSDOFR','totalCrLLOFR'
    ]);

    if (jvToUpdate) {
      await jvdRepo.delete({ journalVoucherId: jvToUpdate.id });
      const nextJV = await jvRepo.save({
        ...jvToUpdate,
        jvType,
        date: savedInvoice.date,
        totalDr: sum('dr'),
        totalDrUSD: sum('drUSD'),
        totalDrLL: sum('drLL'),
        totalDrOFR: sum('drOFR'),
        totalDrUSDOFR: sum('drUSDOFR'),
        totalDrLLOFR: sum('drLLOFR'),
        totalCr: sum('cr'),
        totalCrLL: sum('crLL'),
        totalCrOFR: sum('crOFR'),
        totalCrUSDOFR: sum('crUSDOFR'),
        totalCrLLOFR: sum('crLLOFR'),
      });
      for (const d of details) {
        d.journalVoucherId = nextJV.id;
        await jvdRepo.save(d);
      }
      console.log('✅ Journal voucher updated:', nextJV.jvNumber);
    } else {
      const newJV = this.journalVoucherRepo.create({
        jvNumber: jvNumber!,
        jvType,
        date: savedInvoice.date,
        totalDr: sum('dr'),
        totalDrUSD: sum('drUSD'),
        totalDrLL: sum('drLL'),
        totalDrOFR: sum('drOFR'),
        totalDrUSDOFR: sum('drUSDOFR'),
        totalDrLLOFR: sum('drLLOFR'),
        totalCr: sum('cr'),
        totalCrLL: sum('crLL'),
        totalCrOFR: sum('crOFR'),
        totalCrUSDOFR: sum('crUSDOFR'),
        totalCrLLOFR: sum('crLLOFR'),
        details,
      });
      await queryRunner.manager.save(JournalVoucher, newJV);
      console.log('✅ Journal voucher created:', newJV.jvNumber);
    }

    // Final explicit heal/log (should be no-ops)
    console.log('🧪 Final FK sanity check for invoice_items…');
    const badRows = await queryRunner.manager.query(
      `SELECT id, invoiceId FROM invoice_items WHERE invoiceId IS NULL OR invoiceId = 0`
    );
    if (badRows.length) {
      console.warn('⚠️ Found rows with NULL/0 invoiceId right before commit:', badRows);
      // OPTIONAL: if you want to hard-fix everything created in this tx to current invoiceId:
      // await queryRunner.manager.query(
      //   `UPDATE invoice_items SET invoiceId = ? WHERE (invoiceId IS NULL OR invoiceId = 0)`,
      //   [invoiceId],
      // );
    } else {
      console.log('🟢 No NULL/0 invoiceId rows found');
    }

    await queryRunner.commitTransaction();
    console.log('🎉 Invoice update complete');
    return savedInvoice;
  } catch (error) {
    console.error('❌ Invoice update failed:', error?.message || error);
    await queryRunner.rollbackTransaction();
    throw new BadRequestException(error?.message || 'Invoice update failed');
  } finally {
    await queryRunner.release();
  }
}




}

