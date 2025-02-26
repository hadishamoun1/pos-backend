import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { Customer } from '../entities/customer.entity';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,

    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepository: Repository<InvoiceItem>,

    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  /**
   * ✅ Create a new inventory transaction and update item stock.
   */
  async createTransaction(
    itemVariantId: number,
    transactionType: 'purchase' | 'sale',
    sqm: number,
    invoiceItem?: InvoiceItem, // Optional reference for sales
  ): Promise<InventoryTransaction> {
    // ✅ Validate the item variant
    const itemVariant = await this.itemVariantRepository.findOne({
      where: { id: itemVariantId },
    });
    if (!itemVariant) {
      throw new NotFoundException(
        `ItemVariant with ID ${itemVariantId} not found.`,
      );
    }

    // ✅ Create inventory transaction
    const transaction = this.inventoryTransactionRepository.create({
      itemVariant,
      transactionType,
      sqm,
      invoiceItem, // Link to the invoice item if it's a sale
    });
    await this.inventoryTransactionRepository.save(transaction);

    // ✅ Update inventory stock
    if (transactionType === 'purchase') {
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
    } else if (transactionType === 'sale') {
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
   * ✅ Create a new invoice and track inventory
   */
  async createInvoice(invoiceData: Partial<Invoice>): Promise<Invoice> {
    const {
      customerId,
      invoiceType,
      date,
      currencyRate,
      items,
      ...otherFields
    } = invoiceData;

    // ✅ Validate Customer
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found.`);
    }

    // ✅ Generate Invoice Number
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

    // ✅ Calculate Totals
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

    // ✅ Fix `totalWithoutVAT` Calculation
    const totalWithoutVAT = grandTotal - totalVAT;

    // ✅ Create Invoice
    const invoice = this.invoiceRepository.create({
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
    const savedInvoice = await this.invoiceRepository.save(invoice);

    // ✅ Save Invoice Items and Update Inventory Transactions
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const { itemVariantId, sqm, unitPrice, vat } = item;

        // ✅ Validate Item Variant
        const itemVariant = await this.itemVariantRepository.findOne({
          where: { id: itemVariantId },
        });
        if (!itemVariant) {
          throw new NotFoundException(
            `ItemVariant with ID ${itemVariantId} not found.`,
          );
        }

        // ✅ Create Invoice Item
        const invoiceItem = this.invoiceItemRepository.create({
          invoice: savedInvoice,
          itemVariant,
          sqm,
          unitPrice,
          totalAmount: sqm * unitPrice,
          vat,
        });
        await this.invoiceItemRepository.save(invoiceItem);

        // ✅ Create Inventory Transaction (Deduct Stock)
        await this.createTransaction(itemVariantId, 'sale', sqm, invoiceItem);
      }
    }

    return this.invoiceRepository.findOne({
      where: { id: savedInvoice.id },
      relations: ['customer', 'items'],
    });
  }

  /**
   * ✅ Get All Invoices.
   */
  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      relations: ['customer', 'items'],
    });
  }

  /**
   * ✅ Get Invoice by ID.
   */
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
