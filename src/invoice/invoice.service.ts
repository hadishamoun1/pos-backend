import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,

    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepository: Repository<InvoiceItem>,
  ) {}

  /**
   * ✅ Create a new invoice.
   * ✅ Excludes `branchId` and `currencyId` (they are now optional).
   */
  async createInvoice(invoiceData: Partial<Invoice>): Promise<Invoice> {
    const {
      customerId,
      invoiceType,
      date,
      currencyRate, // ✅ Now required in the request
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

    // ✅ Ensure `currencyRate` is provided
    if (!currencyRate) {
      throw new NotFoundException(`currencyRate is required.`);
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
      totalWithoutVAT, // ✅ Fixed calculation
      totalVAT,
      grandTotal,
      currencyRate, // ✅ Ensure this is stored
      ...otherFields,
    });

    const savedInvoice = await this.invoiceRepository.save(invoice);

    // ✅ Save Invoice Items
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const { itemVariantId, sqm, unitPrice, vat } = item;

        // Create Invoice Item
        const invoiceItem = this.invoiceItemRepository.create({
          invoice: savedInvoice,
          itemVariantId,
          sqm,
          unitPrice,
          totalAmount: sqm * unitPrice,
          vat,
        });

        await this.invoiceItemRepository.save(invoiceItem);
      }
    }

    // ✅ Return Full Invoice with Relations
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
