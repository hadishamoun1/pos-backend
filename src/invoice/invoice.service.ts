import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, DataSource } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { Customer } from '../entities/customer.entity';

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
   * ✅ Create a new inventory transaction and update item stock.
   */
  async createTransaction(
    itemVariantId: number,
    transactionType: 'Purchase' | 'Sale',
    sqm: number,
    invoiceItem?: InvoiceItem,
  ): Promise<InventoryTransaction> {
    const itemVariant = await this.itemVariantRepository.findOne({
      where: { id: itemVariantId },
    });
    if (!itemVariant) {
      throw new NotFoundException(
        `ItemVariant with ID ${itemVariantId} not found.`,
      );
    }

    const transaction = this.inventoryTransactionRepository.create({
      itemVariant,
      transactionType,
      sqm,
      invoiceItem,
    });
    await this.inventoryTransactionRepository.save(transaction);

    if (transactionType === 'Purchase') {
      await this.itemVariantRepository.increment(
        { id: itemVariantId },
        'in',
        sqm,
      );
      await this.itemVariantRepository.increment(
        { id: itemVariantId },
        'balance',
        sqm,
      );
    } else if (transactionType === 'Sale') {
      await this.itemVariantRepository.increment(
        { id: itemVariantId },
        'out',
        sqm,
      );
      await this.itemVariantRepository.decrement(
        { id: itemVariantId },
        'balance',
        sqm,
      );
    }

    return transaction;
  }

  /**
   * ✅ Create a new invoice and track inventory with transaction handling.
   */
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

      const currentYear = new Date(date).getFullYear().toString().slice(-2);
      const prefix = `${invoiceType}${currentYear}`;
      const lastInvoice = await queryRunner.manager.find(Invoice, {
        where: { invoiceNumber: Like(`${prefix}%`) },
        order: { invoiceNumber: 'DESC' },
        take: 1,
      });
      const newInvoiceNumber =
        lastInvoice.length > 0
          ? parseInt(lastInvoice[0].invoiceNumber.split(' - ')[1]) + 1
          : 1;
      const invoiceNumber = `${prefix} - ${newInvoiceNumber}`;

      let totalVAT = 0;
      let grandTotal = 0;

      if (items && Array.isArray(items)) {
        for (const item of items) {
          const { sqm, unitPrice, vat } = item;
          const totalAmount = sqm * unitPrice;
          totalVAT += vat;
          grandTotal += totalAmount + vat;
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

      if (items && Array.isArray(items)) {
        for (const item of items) {
          const { itemVariantId, sqm, unitPrice, vat } = item;

          const itemVariant = await queryRunner.manager.findOne(ItemVariant, {
            where: { id: itemVariantId },
          });
          if (!itemVariant)
            throw new NotFoundException(
              `ItemVariant with ID ${itemVariantId} not found.`,
            );

          const invoiceItem = queryRunner.manager.create(InvoiceItem, {
            invoice: savedInvoice,
            itemVariant,
            sqm,
            unitPrice,
            totalAmount: sqm * unitPrice,
            vat,
          });
          await queryRunner.manager.save(invoiceItem);

          await this.createTransaction(itemVariantId, 'Sale', sqm, invoiceItem);
        }
      }

      await queryRunner.commitTransaction();
      return queryRunner.manager.findOne(Invoice, {
        where: { id: savedInvoice.id },
        relations: ['customer', 'items'],
      });
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
