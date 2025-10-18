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

const sequencePrefix = isG ? 'G' : 'S';                 // G for G, S for S/RVR
const typesForSeq = isG ? ['G'] : ['S', 'RVR'];         // separate sequences

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

const invoiceNumber = `${sequencePrefix}${yearSuffix}-${String(newNumber).padStart(3, '0')}`;
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
      console.log(
        '✅ Saved invoice items:',
        savedItems.map((i) => i.id),
      );

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

      const jvNumber = `${jvPrefix}${yearSuffix}-${String(jvSequence).padStart(3, '0')}`;
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

      function getJVFields(
        type: 'dr' | 'cr',
        val: number,
        valLL: number,
      ): Partial<JournalVoucherDetail> {
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
        } else if (type === 'cr') {
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
      }

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
    } catch (error) {
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
        'items',
        'items.itemVariant',
        'items.itemVariant.thickness',
        'items.itemVariant.thickness.item',
      ],
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // ✅ Format the response to be more user-friendly
    return {
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

      // ✅ Flattened customer info
      customerId: invoice.customer?.id,
      customerName: invoice.customer?.customerName,
      customerInvoiceType: invoice.customer?.invoiceType,

      // ✅ Reformatted items list for easier frontend use
      items: invoice.items.map((item) => {
        const variant = item.itemVariant;
        const thickness = variant?.thickness;
        const itemData = thickness?.item;

        return {
          invoiceItemId: item.id,
          sqm: item.sqm,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
          vat: item.vat,
          quantity: item.quantity, // ✅ Overall quantity (box/sheet)

          // ✅ Item Details
          itemVariantId: variant?.id,
          itemName: itemData?.itemName,
          itemType: itemData?.type, // 'box' or 'sheet'
          thickness: thickness?.thickness, // e.g., "10mm"
          length: variant?.length,
          width: variant?.width,
          origin: variant?.origin,
          sheetsPerBox: variant?.sheetsPerBox, // ✅ Sheets per box
          totalSheets: item.quantity * (variant?.sheetsPerBox || 1), // ✅ Total sheets calculated

          // ✅ Inventory Tracking

          // ✅ Box/Sheet Specific Flags
          fixBox: variant?.fixBox,
          fixLength: variant?.fixLength,
          fixWidth: variant?.fixWidth,
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


 async editInvoice(
  invoiceId: number,
  invoiceData: Partial<Invoice>,
): Promise<Invoice> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    console.log('Editing invoice with ID:', invoiceId);

    // ── 1) Load existing invoice (with items & customer)
    const existingInvoice = await queryRunner.manager.findOne(Invoice, {
      where: { id: invoiceId },
      relations: [
        'items',
        'customer',
        'items.itemVariant',
      ],
    });
    if (!existingInvoice) {
      throw new NotFoundException(`Invoice ID ${invoiceId} not found`);
    }

    // ── 2) Sync item lines (update, add, remove) & related inventory tx
    const incomingItems = Array.isArray(invoiceData.items) ? invoiceData.items : [];
    const incomingByVariantId = new Map<number, any>(
      incomingItems.map((it) => [Number(it.itemVariantId), it]),
    );

    // 2a: remove deleted items
    for (const oldItem of existingInvoice.items) {
      const oldVariantId = Number(oldItem.itemVariant?.id);
      if (!incomingByVariantId.has(oldVariantId)) {
        // remove inventory transaction tied to this invoiceItem
        const oldTx = await queryRunner.manager.findOne(InventoryTransaction, {
          where: { invoiceItem: { id: oldItem.id } },
        });
        if (oldTx) await queryRunner.manager.remove(oldTx);
        await queryRunner.manager.remove(oldItem);
      }
    }

    // 2b: add/update items
    for (const it of incomingItems) {
      if (!it.itemVariantId) {
        throw new BadRequestException('itemVariantId is required for all items');
      }
      const variant = await queryRunner.manager.findOne(ItemVariant, {
        where: { id: Number(it.itemVariantId) },
      });
      if (!variant) {
        throw new NotFoundException(`Item Variant ID ${it.itemVariantId} not found.`);
      }

      const existingItem = existingInvoice.items.find(
        (row) => Number(row.itemVariant?.id) === Number(it.itemVariantId),
      );

      const totalAmount = Number(it.unitPrice) * Number(it.sqm);
      const vatPct = Number(invoiceData.vatPercentage ?? existingInvoice.vatPercentage ?? 0);
      const vat = totalAmount * (vatPct / 100);

      if (existingItem) {
        // update
        existingItem.sqm = Number(it.sqm);
        existingItem.unitPrice = Number(it.unitPrice);
        existingItem.quantity = Number(it.quantity);
        existingItem.totalAmount = totalAmount;
        existingItem.vat = vat;
        await queryRunner.manager.save(existingItem);

        // update inventory tx (if exists)
        const tx = await queryRunner.manager.findOne(InventoryTransaction, {
          where: { invoiceItem: { id: existingItem.id } },
        });
        if (tx) {
          tx.sqm = Number(it.sqm);
          tx.quantity = Number.isFinite(Number(it.quantity)) ? -Number(it.quantity) : tx.quantity;
          tx.transactionType = 'Sales';
          tx.transactionDate = new Date();
          await queryRunner.manager.save(tx);
        } else {
          // create if missing
          const newTx = queryRunner.manager.create(InventoryTransaction, {
            transactionType: 'Sales',
            itemVariantId: variant.id,
            invoiceItemId: existingItem.id,
            sqm: Number(it.sqm),
            quantity: -Number(it.quantity ?? 0),
            transactionDate: new Date(),
            dateForEachInvoice: new Date(existingInvoice.date),
          });
          await queryRunner.manager.save(newTx);
        }
      } else {
        // create new item + tx
        const newItem = queryRunner.manager.create(InvoiceItem, {
          invoice: existingInvoice,
          itemVariant: variant,
          sqm: Number(it.sqm),
          unitPrice: Number(it.unitPrice),
          totalAmount,
          vat,
          quantity: Number(it.quantity),
        });
        await queryRunner.manager.save(newItem);

        const newTx = queryRunner.manager.create(InventoryTransaction, {
          transactionType: 'Sales',
          itemVariantId: variant.id,
          invoiceItemId: newItem.id,
          sqm: Number(it.sqm),
          quantity: -Number(it.quantity ?? 0),
          transactionDate: new Date(),
          dateForEachInvoice: new Date(existingInvoice.date),
        });
        await queryRunner.manager.save(newTx);
      }
    }

    // ── 3) Update top-level invoice fields & recompute totals
    if (invoiceData.currencyRate !== undefined) {
      existingInvoice.currencyRate = Number(invoiceData.currencyRate);
    }
    if (invoiceData.vatPercentage !== undefined) {
      existingInvoice.vatPercentage = Number(invoiceData.vatPercentage);
    }
    if (invoiceData.date) {
      existingInvoice.date = invoiceData.date as any;
    }

    // refresh items from DB to ensure accuracy
    existingInvoice.items = await queryRunner.manager.find(InvoiceItem, {
      where: { invoice: { id: existingInvoice.id } },
      relations: ['itemVariant'],
    });

    existingInvoice.totalWithoutVAT = 0;
    existingInvoice.totalVAT = 0;
    existingInvoice.grandTotal = 0;

    for (const row of existingInvoice.items) {
      existingInvoice.totalWithoutVAT += Number(row.totalAmount || 0);
      existingInvoice.totalVAT += Number(row.vat || 0);
    }
    existingInvoice.grandTotal =
      Number(existingInvoice.totalWithoutVAT) + Number(existingInvoice.totalVAT);

    await queryRunner.manager.save(existingInvoice);

    // ── 4) Update Journal Voucher (mirror createInvoice logic)
    const isReturn = existingInvoice.invoiceType === 'RVR';
    const isG = existingInvoice.invoiceType === 'G';

    const rate = Number(existingInvoice.currencyRate ?? 1);
    const total = Number(existingInvoice.grandTotal);
    const totalWithoutVAT = Number(existingInvoice.totalWithoutVAT);
    const totalVAT = Number(existingInvoice.totalVAT);

    const totalLL = total * rate;
    const totalWithoutVATLL = totalWithoutVAT * rate;
    const totalVATLL = totalVAT * rate;

    // infer currency (adjust if you store currency as a relation)
    const currencyCode = existingInvoice.currencyId === 2 ? 'LL' : 'USD';
    const useVAT = totalVAT > 0;

    // account selection (same as create)
    let salesAccNumber = '';
    let vatAccNumber = '';

    if (useVAT) {
      salesAccNumber = currencyCode === 'USD' ? '701101' : '701102';
      vatAccNumber = currencyCode === 'USD' ? '443101' : '443102';
    } else {
      salesAccNumber = '701103';
    }

    // For G, sales CR = net + VAT (VAT line is zeroed)
    const salesCrAmount = isG ? totalWithoutVAT + totalVAT : totalWithoutVAT;
    const salesCrAmountLL = isG ? totalWithoutVATLL + totalVATLL : totalWithoutVATLL;

    // find JV through docNbr stored on JV details (equal to invoice.invoiceNumber)
    const jv = await queryRunner.manager
      .createQueryBuilder(JournalVoucher, 'jv')
      .leftJoinAndSelect('jv.details', 'd')
      .leftJoinAndSelect('d.account', 'acc')
      .where('jv.jvType = :type', { type: existingInvoice.invoiceType })
      .andWhere('d.docNbr = :doc', { doc: existingInvoice.invoiceNumber })
      .getOne();

    if (!jv) {
      throw new NotFoundException('JournalVoucher not found for this invoice.');
    }

    // helpers to map DR/CR with OFR rules
    const zeroAmounts = (detail: JournalVoucherDetail) => {
      detail.dr = detail.drUSD = detail.drLL = 0;
      detail.drOFR = detail.drUSDOFR = detail.drLLOFR = 0;
      detail.cr = detail.crUSD = detail.crLL = 0;
      detail.crOFR = detail.crUSDOFR = detail.crLLOFR = 0;
    };
    const applyJVFields = (
      detail: JournalVoucherDetail,
      kind: 'dr' | 'cr',
      val: number,
      valLL: number,
    ) => {
      zeroAmounts(detail);
      if (kind === 'dr') {
        if (isG) {
          detail.drOFR = val; detail.drUSDOFR = val; detail.drLLOFR = valLL;
        } else if (isReturn) {
          detail.dr = val; detail.drUSD = val; detail.drLL = valLL;
        } else {
          detail.dr = val; detail.drUSD = val; detail.drLL = valLL;
          detail.drOFR = val; detail.drUSDOFR = val; detail.drLLOFR = valLL;
        }
      } else {
        if (isG) {
          detail.crOFR = val; detail.crUSDOFR = val; detail.crLLOFR = valLL;
        } else if (isReturn) {
          detail.cr = val; detail.crUSD = val; detail.crLL = valLL;
        } else {
          detail.cr = val; detail.crUSD = val; detail.crLL = valLL;
          detail.crOFR = val; detail.crUSDOFR = val; detail.crLLOFR = valLL;
        }
      }
    };

    // update JV details
    for (const d of jv.details) {
      // customer line (no account, has customerId)
      if (d.customerId) {
        applyJVFields(d, 'dr', total, totalLL);
        d.currency = currencyCode;
        d.description = isReturn ? 'فاتورة' : 'فاتورة';
        continue;
      }

      // sales revenue line
      if (d.account?.accountNumber === salesAccNumber) {
        applyJVFields(d, 'cr', salesCrAmount, salesCrAmountLL);
        d.currency = currencyCode;
        d.description = 'Sales Revenue';
        continue;
      }

      // VAT line
      if (d.account?.accountNumber === vatAccNumber) {
        if (useVAT && !isG) {
          applyJVFields(d, 'cr', totalVAT, totalVATLL);
          d.currency = currencyCode;
          d.description = 'VAT Payable';
        } else {
          zeroAmounts(d);
          d.currency = currencyCode;
          d.description = 'VAT Payable';
        }
        continue;
      }

      // any other legacy/extra lines -> zero
      zeroAmounts(d);
    }

    // recompute JV header totals
    const sum = (field: keyof JournalVoucherDetail) =>
      jv.details.reduce((acc, entry) => acc + Number(entry[field] || 0), 0);

    jv.totalDr = sum('dr');
    jv.totalDrUSD = sum('drUSD');
    jv.totalDrLL = sum('drLL');
    jv.totalDrOFR = sum('drOFR');
    jv.totalDrUSDOFR = sum('drUSDOFR');
    jv.totalDrLLOFR = sum('drLLOFR');

    jv.totalCr = sum('cr');
    jv.totalCrUSD = sum('crUSD');
    jv.totalCrLL = sum('crLL');
    jv.totalCrOFR = sum('crOFR');
    jv.totalCrUSDOFR = sum('crUSDOFR');
    jv.totalCrLLOFR = sum('crLLOFR');

    // keep JV header aligned
    jv.date = existingInvoice.date;
    jv.jvType = existingInvoice.invoiceType;

    await queryRunner.manager.save(jv.details);
    await queryRunner.manager.save(jv);

    await queryRunner.commitTransaction();
    console.log('✅ Invoice & JournalVoucher updated successfully!');
    return existingInvoice;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error('❌ Error updating invoice/JV:', error.message, error.stack);
    throw new BadRequestException(`Invoice/JV update failed: ${error.message}`);
  } finally {
    await queryRunner.release();
  }
}

  // invoices.service.ts
async getBrowsingInvoices(
  customerId: number,
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // = itemDescriptionId as string
) {
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.itemNameDescription',
    ],
    order: { date: 'DESC' }, // recency only affects which invoices we pick from; sorting is done below
  });

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const nullLast = (n: any) =>
    n == null || Number.isNaN(Number(n)) ? Number.POSITIVE_INFINITY : Number(n);

  /**
   * EXACT ItemsService-style ordering inside a group:
   * Item (sortIndex -> name) → Thickness (sort_index -> thickness) → Dims (area desc, L desc, W desc) → Type/SPB
   */
  function orderLikeItemsService(rows: any[]) {
    // 1) Group by itemName (outer level)
    const byItem = new Map<string, any[]>();
    for (const r of rows) {
      const key = r.itemName ?? '';
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key)!.push(r);
    }

    // order items: item.sortIndex NULLS LAST, then itemName ASC
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

      // 2) Group by thickness value
      const byTh = new Map<number, any[]>();
      for (const r of rowsOfItem) {
        const th = toNum(r.thickness);
        if (!byTh.has(th)) byTh.set(th, []);
        byTh.get(th)!.push(r);
      }

      // order thickness: thickness.sort_index NULLS LAST, then numeric thickness ASC
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

        // 3) Dims vs non-dims
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

        // emit per dims group: box (SPB DESC, variantId) → sheet (variantId) → sqm
        for (const dk of dimKeys) {
          const g = byDims.get(dk)!;

          const boxes = g
            .filter((x) => x.type === 'box')
            .sort(
              (a, b) =>
                (toNum(b.sheetsPerBox) || 0) - (toNum(a.sheetsPerBox) || 0) ||
                toNum(a.itemVariantId) - toNum(b.itemVariantId)
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

  // Flatten invoice items → row objects used by the sorter
  const allItems = invoices.flatMap((invoice) =>
    invoice.items.map((item) => {
      const variant = item.itemVariant;
      const th = variant?.thickness;
      const it = th?.item;
      const desc = variant?.itemNameDescription;
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

      return {
        // grouping identity
        itemDescriptionId: desc?.id || 0,

        // display
        invoiceDate: invoice.date,
        invoiceNumber: invoice.invoiceNumber,
        itemName: it?.itemName || '',
        descriptionName: it?.itemName || '',

        // sort signals (BOTH captured)
        itemSortIndex: (it as any)?.sortIndex ?? (it as any)?.sort_index ?? null,
        thickness: th?.thickness ?? '',
        thicknessSortIndex: (th as any)?.sort_index ?? (th as any)?.sortIndex ?? null,

        // attributes for dims/type sort
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

        // refs
        itemVariantId: variant?.id || 0,
        itemBatchId: batch?.id || 0,
      };
    }),
  );

  // Group by itemDescriptionId (what your UI expects)
  const grouped = new Map<string, any[]>();
  for (const row of allItems) {
    const key = String(row.itemDescriptionId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  // Group slice helper
  function buildGroupPayload(key: string, items: any[], page = 1) {
    const ordered = orderLikeItemsService(items);
    const start = (page - 1) * limitPerGroup;
    const slice = ordered.slice(start, start + limitPerGroup);

    return {
      groupKey: key,
      descriptionName: items[0]?.descriptionName || '',
      items: slice,
      total: ordered.length,
      page,
      totalPages: Math.ceil(ordered.length / limitPerGroup),
    };
  }

  // If a specific group is requested (pagination for one group)
  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return buildGroupPayload(groupKey, items, pagePerGroup);
  }

  // Build all groups (page 1 for each)
  const groups = Array.from(grouped.entries()).map(([key, items]) =>
    buildGroupPayload(key, items, 1),
  );

  // Order groups themselves by Item order (sortIndex NULLS LAST → name ASC).
  // We take the **first row's** signals from each group's ordered slice,
  // or compute from the whole group if slice is empty.
const groupOrderKey = (g: any) => {
  const fallbackGroup = grouped.get(g.groupKey);
  const src = (g.items[0] ?? (fallbackGroup ? fallbackGroup[0] : undefined)) ?? {};
  const sortIdx = nullLast(src.itemSortIndex);
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





async getBrowsingInvoicesByItemBatches(
  customerId: number,
  itemBatchIds: number[],
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // itemDescriptionId as string
) {
  // 1) Resolve selected batches -> their itemDescriptionIds
  const batches = await this.itemBatchRepository.find({
    where: { id: In(itemBatchIds) },
    relations: [
      'itemVariant',
      'itemVariant.itemNameDescription',
      'itemVariant.thickness',
      'itemVariant.thickness.item',
    ],
  });

  const descriptionIds = Array.from(
    new Set(
      batches
        .map(b => b.itemVariant?.itemNameDescription?.id)
        .filter((id): id is number => !!id)
    )
  );

  if (descriptionIds.length === 0) {
    // nothing maps -> empty result
    return groupKey ? {
      groupKey,
      descriptionName: '',
      items: [],
      total: 0,
      page: pagePerGroup,
      totalPages: 0,
    } : [];
  }

  // 2) Fetch invoices for this customer, but only items whose description is in that set
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.itemNameDescription',
    ],
    order: { date: 'DESC' },
  });

  // 3) Flatten and filter rows by descriptionIds
  function getPriority(name: string) {
    const n = name?.toLowerCase() || '';
    if (n.includes('تريبلكس ابيض')) return 3;
    if (n.includes('برونز')) return 2;
    if (n.includes('اسود')) return 1;
    if (n.includes('ابيض')) return 0;
    return 99;
  }
  const safeNum = (x: any) => {
    const n = parseFloat(String(x));
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };

  const allItems = invoices.flatMap((invoice) =>
    invoice.items
      .filter((it) => {
        const descId = it.itemVariant?.itemNameDescription?.id;
        return descId && descriptionIds.includes(descId);
      })
      .map((item) => {
        const variant = item.itemVariant;
        const thicknessEntity = variant?.thickness;
        const itemData = thicknessEntity?.item;
        const itemDesc = variant?.itemNameDescription;
        const type = itemData?.type || '';

        // pull dimensions (adjust if your schema stores them elsewhere)
        const length =
          (variant as any)?.length ??
          (variant as any)?.dimensions?.length ??
          null;
        const width =
          (variant as any)?.width ??
          (variant as any)?.dimensions?.width ??
          null;

        return {
          // grouping identity
          itemDescriptionId: itemDesc?.id || 0,

          // row fields
          invoiceDate: invoice.date,
          invoiceNumber: invoice.invoiceNumber,
          itemName: itemData?.itemName || '',
          descriptionName: itemData?.itemName || '',

          thickness: thicknessEntity?.thickness ?? '',
          origin: variant?.origin ?? '',
          type,

          // quantity modes
          box: type === 'box' ? item.quantity : 0,
          sheet: type === 'sheet' ? item.quantity : 0,
          sheetsPerBox: type === 'box' ? variant?.sheetsPerBox || 0 : null,
          sqm: item.sqm,

          // prices
          unitPrice: item.unitPrice,
          vat: item.vat,
          totalAmount: item.totalAmount,

          // dimensions
          length,
          width,

          // references
          itemVariantId: variant?.id || 0,
          itemBatchId: item.itemBatch?.id || 0,
        };
      })
  );

  // 4) Group by itemDescriptionId ONLY
  const grouped = new Map<string, any[]>();
  for (const row of allItems) {
    const key = String(row.itemDescriptionId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  // Helper to build a single page response for one group
  const pageGroup = (key: string, items: any[]) => {
    const sorted = items.sort(
      (a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()
    );
    const start = (pagePerGroup - 1) * limitPerGroup;
    return {
      groupKey: key,
      descriptionName: items[0]?.descriptionName || '',
      items: sorted.slice(start, start + limitPerGroup),
      total: sorted.length,
      page: pagePerGroup,
      totalPages: Math.ceil(sorted.length / limitPerGroup),
    };
  };

  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return pageGroup(groupKey, items);
  }

  // 5) Build first page per group
  const groups = Array.from(grouped.entries()).map(([key, items]) => {
    const sorted = items.sort(
      (a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()
    );
    return {
      groupKey: key,
      descriptionName: items[0]?.descriptionName || '',
      items: sorted.slice(0, limitPerGroup),
      total: items.length,
      page: 1,
      totalPages: Math.ceil(items.length / limitPerGroup),
      latestInvoiceDate: sorted[0]?.invoiceDate ?? null,
    };
  });

  // 6) Sort groups by priority then min thickness ASC
  return groups.sort((a, b) => {
    const priA = getPriority(a.descriptionName);
    const priB = getPriority(b.descriptionName);
    if (priA !== priB) return priA - priB;

    const minThA = Math.min(...a.items.map((r: any) => safeNum(r.thickness)));
    const minThB = Math.min(...b.items.map((r: any) => safeNum(r.thickness)));
    return minThA - minThB;
  });
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
    groupKey?: string,
  ) {
    // 1) Load same data
    const invoices = await this.invoiceRepository.find({
      where: { customer: { id: customerId } },
      relations: [
        'items',
        'items.itemBatch',
        'items.itemVariant',
        'items.itemVariant.thickness',
        'items.itemVariant.thickness.item',
        'items.itemVariant.itemNameDescription',
      ],
      order: { date: 'DESC' },
    });

    // 2) Flatten to rows (same as your getBrowsingInvoices)
    const allRows = invoices.flatMap((invoice) =>
      invoice.items.map((item) => {
        const variant = item.itemVariant;
        const th = variant?.thickness;
        const it = th?.item;
        const desc = variant?.itemNameDescription;
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

        return {
          itemDescriptionId: desc?.id || 0,

          // display
          invoiceDate: invoice.date,
          invoiceNumber: invoice.invoiceNumber,
          itemName: it?.itemName || '',
          descriptionName: it?.itemName || '',

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

    // 3) Parse the query and filter
    const parsed = this.parseSearchQuery(q);
    const filtered = parsed.nameTokens.length ||
      parsed.thickness != null ||
      parsed.dims != null ||
      parsed.impliedType
      ? allRows.filter((r) => this.rowMatchesSearch(r, parsed))
      : allRows;

    // 4) Group by itemDescriptionId (same as browsing)
    const grouped = new Map<string, any[]>();
    for (const row of filtered) {
      const key = String(row.itemDescriptionId);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    // 5) If single group pagination
    if (groupKey) {
      const items = grouped.get(groupKey) || [];
      return this.buildGroupPayload(groupKey, items, limitPerGroup, pagePerGroup);
    }

    // 6) Build all groups (page 1 for each)
    const groups = Array.from(grouped.entries()).map(([key, items]) =>
      this.buildGroupPayload(key, items, limitPerGroup, 1),
    );

    // 7) Order groups themselves by Item order (sortIndex NULLS LAST → name ASC).
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




}
// async editInvoice(
//   invoiceId: number,
//   invoiceData: Partial<Invoice>,
// ): Promise<Invoice> {
//   const queryRunner = this.dataSource.createQueryRunner();
//   await queryRunner.connect();
//   await queryRunner.startTransaction();

//   try {
//     console.log('Editing invoice with ID:', invoiceId);

//     // Step 1: Fetch the existing invoice and the sales voucher with its details
//     const existingInvoice = await queryRunner.manager.findOne(Invoice, {
//       where: { id: invoiceId },
//       relations: [
//         'items',
//         'customer',
//         'items.itemVariant',
//         'salesVouchers',
//         'salesVouchers.details',
//         'salesVouchers.details.account',
//       ],
//     });

//     if (!existingInvoice) {
//       throw new NotFoundException(`Invoice ID ${invoiceId} not found`);
//     }

//     console.log('Existing invoice fetched:', existingInvoice);

//     // Step 2: Reverse the old inventory transactions (to undo the previous sale)
//     for (const item of existingInvoice.items) {
//       if (item.itemVariant) {
//         // Reverse the previous inventory transaction
//         const inventoryTransaction = await queryRunner.manager.findOne(
//           InventoryTransaction,
//           {
//             where: { invoiceItem: item },
//           },
//         );

//         if (inventoryTransaction) {
//           await queryRunner.manager.update(
//             ItemVariant,
//             { id: item.itemVariant.id },
//             {
//               out: () => `out - ${inventoryTransaction.sqm}`,
//               balance: () => `balance + ${inventoryTransaction.sqm}`,
//             },
//           );

//           await queryRunner.manager.remove(inventoryTransaction); // Remove the old inventory transaction
//         } else {
//           console.warn('No inventory transaction found for item:', item);
//         }
//       } else {
//         console.error('Item Variant is missing for item:', item);
//       }
//     }

//     // Step 3: Update the invoice core fields (currencyRate, vatPercentage)
//     existingInvoice.currencyRate =
//       invoiceData.currencyRate || existingInvoice.currencyRate;
//     existingInvoice.vatPercentage =
//       invoiceData.vatPercentage || existingInvoice.vatPercentage;

//     // Step 4: Update the invoice details with the new data
//     existingInvoice.items = [];
//     existingInvoice.totalWithoutVAT = 0;
//     existingInvoice.totalVAT = 0;
//     existingInvoice.grandTotal = 0;

//     for (const itemData of invoiceData.items) {
//       console.log('Item data:', itemData);

//       if (!itemData.itemVariantId) {
//         throw new NotFoundException(
//           `Item Variant ID ${itemData.itemVariantId} not found.`,
//         );
//       }

//       const itemVariant = await queryRunner.manager.findOne(ItemVariant, {
//         where: { id: itemData.itemVariantId },
//       });

//       if (!itemVariant) {
//         throw new NotFoundException(
//           `Item Variant ID ${itemData.itemVariantId} not found.`,
//         );
//       }

//       // Calculate the totalAmount, vat, and grandTotal
//       const totalAmount = itemData.sqm * itemData.unitPrice;
//       const vat = totalAmount * (existingInvoice.vatPercentage / 100);
//       const grandTotal = totalAmount + vat;

//       const invoiceItem = queryRunner.manager.create(InvoiceItem, {
//         invoice: existingInvoice,
//         itemVariant,
//         sqm: itemData.sqm,
//         unitPrice: itemData.unitPrice,
//         totalAmount: totalAmount,
//         vat: vat,
//         quantity: itemData.quantity,
//       });

//       existingInvoice.items.push(invoiceItem);
//       existingInvoice.totalWithoutVAT += totalAmount;
//       existingInvoice.totalVAT += vat;
//       existingInvoice.grandTotal += grandTotal;

//       await queryRunner.manager.save(invoiceItem);
//     }

//     // Step 5: Update the corresponding SalesVoucher and SalesVoucherDetail for the invoice
//     const salesVoucher = existingInvoice.salesVouchers[0]; // Assuming only one salesVoucher for each invoice

//     if (!salesVoucher) {
//       throw new NotFoundException('SalesVoucher not found for this invoice.');
//     }

//     // Debugging: Check the values before updating the SalesVoucher
//     console.log('Total Without VAT:', existingInvoice.totalWithoutVAT);
//     console.log('Total VAT:', existingInvoice.totalVAT);
//     console.log('Currency Rate:', existingInvoice.currencyRate);
//     console.log('Vat Percentage', existingInvoice.vatPercentage);

//     // Update SalesVoucher
//     salesVoucher.totalDr = existingInvoice.grandTotal;
//     salesVoucher.totalCr = existingInvoice.grandTotal;
//     salesVoucher.totalDrUSD = existingInvoice.grandTotal;
//     salesVoucher.totalCrUSD = existingInvoice.grandTotal;
//     salesVoucher.totalDrLL =
//       existingInvoice.grandTotal * existingInvoice.currencyRate;
//     salesVoucher.totalCrLL =
//       existingInvoice.grandTotal * existingInvoice.currencyRate;

//     // Loop through SalesVoucherDetails and update them
//     for (const detail of salesVoucher.details) {
//       if (detail.account) {
//         const account = detail.account; // Account object
//         console.log(
//           `Updating SalesVoucherDetail (ID: ${detail.id}) for account: ${account.accountNumber}`,
//         );

//         if (account.accountNumber === '7011') {
//           // For account 7011 (Sales): Set credit to total without VAT, set debit to 0
//           console.log('Setting values for account 7011 (Sales)');
//           detail.cr = existingInvoice.totalWithoutVAT;
//           detail.crUSD = existingInvoice.totalWithoutVAT;
//           detail.crLL =
//             existingInvoice.totalWithoutVAT * existingInvoice.currencyRate;
//           detail.dr = 0;
//           detail.drUSD = 0;
//           detail.drLL = 0;
//         } else if (account.accountNumber === '4431') {
//           // For account 4431 (VAT): Set credit to total VAT, set debit to 0
//           console.log('Setting values for account 4431 (VAT)');
//           detail.cr = existingInvoice.totalVAT;
//           detail.crUSD = existingInvoice.totalVAT;
//           detail.crLL =
//             existingInvoice.totalVAT * existingInvoice.currencyRate;
//           detail.dr = 0;
//           detail.drUSD = 0;
//           detail.drLL = 0;
//         }
//       } else {
//         // If account is null (Customer transaction)
//         console.log('Setting values for customer transaction');
//         detail.dr = existingInvoice.grandTotal;
//         detail.drUSD = existingInvoice.grandTotal;
//         detail.drLL =
//           existingInvoice.grandTotal * existingInvoice.currencyRate;
//         detail.cr = 0;
//         detail.crUSD = 0;
//         detail.crLL = 0;
//       }

//       // Print the updated details to check
//       console.log('Updated SalesVoucherDetail:', detail);

//       // Save the updated SalesVoucherDetail
//       await queryRunner.manager.save(detail);
//     }

//     // Save the updated SalesVoucher
//     await queryRunner.manager.save(salesVoucher);

//     // Step 6: Commit the transaction
//     await queryRunner.commitTransaction();
//     console.log('✅ Invoice and SalesVoucher updated successfully!');

//     return existingInvoice;
//   } catch (error) {
//     await queryRunner.rollbackTransaction();
//     console.error(
//       '❌ Error updating invoice and sales voucher:',
//       error.message,
//       error.stack,
//     );
//     throw new Error(
//       `Invoice and SalesVoucher update failed: ${error.message}`,
//     );
//   } finally {
//     await queryRunner.release();
//   }
// }
