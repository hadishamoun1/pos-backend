import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, DataSource } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { Branch } from '../entities/branch.entity';
import { Currency } from '../entities/currency.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource, // Used for transactions
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepository: Repository<InvoiceItem>,
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,
    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,
  ) {}

  /**
   * Create a new invoice and update inventory stock accordingly.
   */
  async createInvoice(invoiceData: Partial<Invoice>): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction(); // Start transaction

    try {
      const {
        customerId,
        branchId,
        currencyId,
        invoiceType,
        date,
        items,
        ...otherFields
      } = invoiceData;

      // Validate related entities
      const customer = await this.customerRepository.findOne({
        where: { id: customerId },
      });
      if (!customer)
        throw new NotFoundException(
          `Customer with ID ${customerId} not found.`,
        );

      const branch = await this.branchRepository.findOne({
        where: { id: branchId },
      });
      if (!branch)
        throw new NotFoundException(`Branch with ID ${branchId} not found.`);

      const currency = await this.currencyRepository.findOne({
        where: { id: currencyId },
      });
      if (!currency)
        throw new NotFoundException(
          `Currency with ID ${currencyId} not found.`,
        );

      // Generate the next invoice number
      const currentYear = new Date(date).getFullYear().toString().slice(-2);
      const prefix = `${invoiceType}${currentYear}`;
      const lastInvoice = await this.invoiceRepository.find({
        where: { invoiceNumber: Like(`${prefix}%`) },
        order: { invoiceNumber: 'DESC' },
        take: 1,
      });

      const newInvoiceNumber =
        lastInvoice.length > 0
          ? parseInt(lastInvoice[0].invoiceNumber.split(' - ')[1]) + 1
          : 1;
      const invoiceNumber = `${prefix} - ${newInvoiceNumber}`;

      // 🔹 Calculate totals
      let totalWithoutVAT = 0;
      let totalVAT = 0;
      let grandTotal = 0;

      // Loop through items to compute totals
      if (items && Array.isArray(items)) {
        for (const item of items) {
          const { itemVariantId, sqm, unitPrice, vat } = item;

          // Validate ItemVariant
          const itemVariant = await this.itemVariantRepository.findOne({
            where: { id: itemVariantId },
          });
          if (!itemVariant)
            throw new NotFoundException(
              `ItemVariant with ID ${itemVariantId} not found.`,
            );

          // Calculate totals for each item
          const totalAmount = sqm * unitPrice;
          totalWithoutVAT += totalAmount;
          totalVAT += vat;
          grandTotal += totalAmount + vat;
        }
      }

      // Create and save the invoice with calculated totals
      const invoice = this.invoiceRepository.create({
        customer,
        branch,
        currency,
        invoiceNumber,
        invoiceType,
        date,
        totalWithoutVAT,
        totalVAT,
        grandTotal,
        ...otherFields,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);

      // Handle invoice items
      if (items && Array.isArray(items)) {
        for (const item of items) {
          const { itemVariantId, sqm, unitPrice, vat } = item;

          // Save Invoice Item
          const invoiceItem = this.invoiceItemRepository.create({
            invoice: savedInvoice,
            itemVariant: { id: itemVariantId },
            sqm,
            unitPrice,
            totalAmount: sqm * unitPrice,
            vat,
          });

          await queryRunner.manager.save(invoiceItem);
        }
      }

      // Commit transaction
      await queryRunner.commitTransaction();

      // Fetch the full invoice details with relations
      return this.invoiceRepository.findOne({
        where: { id: savedInvoice.id },
        relations: ['customer', 'branch', 'currency', 'items'],
      });
    } catch (error) {
      await queryRunner.rollbackTransaction(); // Rollback transaction if any error occurs
      throw error;
    } finally {
      await queryRunner.release(); // Release query runner
    }
  }

  /**
   * Fetch all invoices with related data.
   */
  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      relations: ['customer', 'branch', 'currency', 'items'],
    });
  }

  /**
   * Fetch a single invoice by ID with its details.
   */
  async getInvoiceById(id: number): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: ['customer', 'branch', 'currency', 'items'],
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found.`);
    }
    return invoice;
  }
}
