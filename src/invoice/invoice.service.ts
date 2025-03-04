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

@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource, // ✅ Inject DataSource for transactions

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,

    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
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
        items,
        ...otherFields
      } = invoiceData;

      const customer = await queryRunner.manager.findOne(Customer, {
        where: { id: customerId },
      });
      if (!customer)
        throw new NotFoundException(
          `Customer with ID ${customerId} not found.`,
        );

      const invoiceNumber = await this.generateInvoiceNumber(
        invoiceType,
        queryRunner,
      );

      let totalVAT = 0;
      let grandTotal = 0;
      let invoiceItems: InvoiceItem[] = [];

      if (items && Array.isArray(items)) {
        for (const item of items) {
          const { itemVariantId, sqm, unitPrice, vat } = item;
          const totalAmount = sqm * unitPrice;
          totalVAT += vat;
          grandTotal += totalAmount + vat;

          const itemVariant = await queryRunner.manager.findOne(ItemVariant, {
            where: { id: itemVariantId },
          });
          if (!itemVariant) {
            throw new NotFoundException(
              `ItemVariant with ID ${itemVariantId} not found.`,
            );
          }

          const invoiceItem = queryRunner.manager.create(InvoiceItem, {
            invoice: null,
            itemVariant,
            sqm,
            unitPrice,
            totalAmount,
            vat,
          });

          invoiceItems.push(invoiceItem);
        }
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
        ...otherFields,
      });
      const savedInvoice = await queryRunner.manager.save(invoice);

      for (const item of invoiceItems) {
        item.invoice = savedInvoice;
        await queryRunner.manager.save(item);
      }

      // ✅ Generate Sales Voucher
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

      // ✅ Insert Sales Voucher Details
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

      await queryRunner.commitTransaction();

      const finalInvoice = await queryRunner.manager.findOne(Invoice, {
        where: { id: savedInvoice.id },
        relations: ['customer', 'items', 'items.itemVariant'],
      });

      return finalInvoice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      relations: ['customer', 'items'],
    });
  }

  async getInvoiceById(id: number): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: ['customer', 'items'],
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found.`);
    }
    return invoice;
  }
}
