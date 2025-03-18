import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, DataSource } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { Customer } from '../entities/customer.entity';
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity';
import { SalesVoucherDetail } from '../entities/Vouchers/salesVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { InvoiceGateway } from './invoice.gateway';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly invoiceGateway: InvoiceGateway,
  ) {}

  /**
   * ✅ Generate a unique Invoice Number (S25-001 or G25-001)
   */
  private async generateInvoiceNumber(
    invoiceType: 'S' | 'G',
    queryRunner: any,
  ): Promise<string> {
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = `${invoiceType}${year}`;
    const lastInvoice = await queryRunner.manager.findOne(Invoice, {
      where: { invoiceNumber: Like(`${prefix}-%`) },
      order: { invoiceNumber: 'DESC' },
    });

    let nextNumber = 1;
    if (lastInvoice) {
      const match = lastInvoice.invoiceNumber.match(/\d+$/);
      if (match) {
        nextNumber = parseInt(match[0], 10) + 1;
      }
    }
    return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
  }

  async createInvoice(invoiceData: Partial<Invoice>): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const {
        customerId,
        invoiceType,
        date,
        currencyRate,
        vatPercentage,
        items,
        ...otherFields
      } = invoiceData;

      if (!customerId || !invoiceType || !date || !currencyRate) {
        throw new Error(
          `Missing required fields: customerId=${customerId}, invoiceType=${invoiceType}, date=${date}, currencyRate=${currencyRate}`,
        );
      }

      console.log('🔍 Processing Invoice Creation...');

      const customer = await queryRunner.manager.findOne(Customer, {
        where: { id: customerId },
      });
      if (!customer)
        throw new NotFoundException(`Customer ID ${customerId} not found.`);

      const invoiceNumber = await this.generateInvoiceNumber(
        invoiceType,
        queryRunner,
      );

      let totalVAT = 0;
      let grandTotal = 0;
      let invoiceItems: InvoiceItem[] = [];

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('No items provided for the invoice.');
      }

      for (const item of items) {
        if (
          !item.itemVariantId ||
          item.sqm === undefined ||
          item.unitPrice === undefined ||
          item.vat === undefined ||
          item.quantity === undefined
        ) {
          throw new Error(`Invalid item data: ${JSON.stringify(item)}`);
        }

        const itemVariant = await queryRunner.manager.findOne(ItemVariant, {
          where: { id: item.itemVariantId },
        });

        if (!itemVariant) {
          throw new NotFoundException(
            `ItemVariant ID ${item.itemVariantId} not found.`,
          );
        }

        const sqm =
          typeof item.sqm === 'string' ? parseFloat(item.sqm) : item.sqm;
        const unitPrice =
          typeof item.unitPrice === 'string'
            ? parseFloat(item.unitPrice)
            : item.unitPrice;
        const vat =
          typeof item.vat === 'string' ? parseFloat(item.vat) : item.vat;

        const quantity =
          typeof item.quantity === 'string'
            ? parseInt(item.quantity, 10)
            : item.quantity;

        if (isNaN(sqm) || isNaN(unitPrice) || isNaN(vat) || isNaN(quantity)) {
          throw new Error(
            `Invalid number values for itemVariantId ${item.itemVariantId}: sqm=${sqm}, unitPrice=${unitPrice}, vat=${vat}, quantity=${quantity}`,
          );
        }

        const totalAmount = sqm * unitPrice;
        totalVAT += vat;
        grandTotal += totalAmount + vat;

        const invoiceItem = queryRunner.manager.create(InvoiceItem, {
          invoice: null,
          itemVariant,
          sqm,
          unitPrice,
          totalAmount,
          vat,
          quantity,
        });

        invoiceItems.push(invoiceItem);
      }

      const totalWithoutVAT = grandTotal - totalVAT;
      const invoice = queryRunner.manager.create(Invoice, {
        customer,
        invoiceNumber,
        invoiceType,
        date,
        totalWithoutVAT,
        totalVAT,
        grandTotal,
        currencyRate,
        vatPercentage,
        ...otherFields,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);
      console.log('✅ Invoice Created:', savedInvoice);

      for (const item of invoiceItems) {
        item.invoice = savedInvoice;
        await queryRunner.manager.save(item);
      }

      const svNumber = await this.generateInvoiceNumber(
        invoiceType,
        queryRunner,
      );
      const salesVoucher = queryRunner.manager.create(SalesVoucher, {
        date,
        invoice: savedInvoice,
        svNumber,
        totalDr: grandTotal,
        totalDrUSD: grandTotal,
        totalDrLL: grandTotal * currencyRate,
        totalCr: grandTotal,
        totalCrUSD: grandTotal,
        totalCrLL: grandTotal * currencyRate,
        exchangeRate: currencyRate,
      });
      const savedVoucher = await queryRunner.manager.save(salesVoucher);

      await queryRunner.manager.save([
        queryRunner.manager.create(SalesVoucherDetail, {
          salesVoucher: savedVoucher,
          customer,
          dr: grandTotal,
          drUSD: grandTotal,
          drLL: grandTotal * currencyRate,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          exchangeRate: currencyRate,
        }),
        queryRunner.manager.create(SalesVoucherDetail, {
          salesVoucher: savedVoucher,
          account: await queryRunner.manager.findOne(Account, {
            where: { accountNumber: '7011' },
          }),
          cr: totalWithoutVAT,
          crUSD: totalWithoutVAT,
          crLL: totalWithoutVAT * currencyRate,
          dr: 0,
          drUSD: 0,
          drLL: 0,
          exchangeRate: currencyRate,
        }),
        queryRunner.manager.create(SalesVoucherDetail, {
          salesVoucher: savedVoucher,
          account: await queryRunner.manager.findOne(Account, {
            where: { accountNumber: '4431' },
          }),
          cr: totalVAT,
          crUSD: totalVAT,
          crLL: totalVAT * currencyRate,
          dr: 0,
          drUSD: 0,
          drLL: 0,
          exchangeRate: currencyRate,
        }),
      ]);

      for (const item of invoiceItems) {
        const inventoryTransaction = queryRunner.manager.create(
          InventoryTransaction,
          {
            itemVariant: item.itemVariant,
            transactionType: 'sale',
            sqm: item.sqm,
            transactionDate: new Date(),
            invoiceItem: item,
          },
        );

        await queryRunner.manager.save(inventoryTransaction);
        await queryRunner.manager.increment(
          ItemVariant,
          { id: item.itemVariant.id },
          'out',
          item.sqm,
        );
        await queryRunner.manager.decrement(
          ItemVariant,
          { id: item.itemVariant.id },
          'balance',
          item.sqm,
        );
      }

      await queryRunner.commitTransaction();
      console.log('✅ Invoice successfully committed.');

      const finalInvoice = await queryRunner.manager.findOne(Invoice, {
        where: { id: savedInvoice.id },
        relations: ['customer', 'items', 'items.itemVariant'],
      });

      const { customerName } = finalInvoice.customer || {}; // Extract customerName
      const invoiceToEmit = {
        ...finalInvoice,
        customerName, // Add customerName directly to the emitted invoice
      };
      
      // Emit the new invoice to all connected clients via WebSocket
      this.invoiceGateway.emitNewInvoice(invoiceToEmit);
      console.log(`invoice: ${JSON.stringify(invoiceToEmit)}`);
      return finalInvoice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Error creating invoice:', error.message, error.stack);
      throw new Error(`Invoice creation failed: ${error.message}`);
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
          inventoryStart: variant?.start,
          inventoryIn: variant?.in,
          inventoryOut: variant?.out,
          inventoryBalance: variant?.balance,

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
    const [invoices, total] = await this.invoiceRepository.findAndCount({
      relations: ['customer'],
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
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
      totalPages: Math.ceil(total / limit),
    };
  }
}
