import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { Branch } from '../entities/branch.entity';
import { Currency } from '../entities/currency.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';

@Injectable()
export class InvoiceService {
  constructor(
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
  ) {}

  async createInvoice(invoiceData: Partial<Invoice>): Promise<Invoice> {
    const {
      customerId,
      branchId,
      currencyId,
      invoiceType,
      date,
      items, // Extract items from the payload
      ...otherFields
    } = invoiceData;

    // Validate related entities
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found.`);
    }

    const branch = await this.branchRepository.findOne({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID ${branchId} not found.`);
    }

    const currency = await this.currencyRepository.findOne({
      where: { id: currencyId },
    });
    if (!currency) {
      throw new NotFoundException(`Currency with ID ${currencyId} not found.`);
    }

    // Get current year for invoice number
    const currentYear = new Date(date).getFullYear().toString().slice(-2);

    // Generate the next invoice number
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

    // Create and save the invoice
    const invoice = this.invoiceRepository.create({
      customer,
      branch,
      currency,
      invoiceNumber,
      invoiceType,
      date,
      ...otherFields,
    });
    const savedInvoice = await this.invoiceRepository.save(invoice);

    // Handle items
    if (items && Array.isArray(items)) {
      const invoiceItems = items.map((item) =>
        this.invoiceItemRepository.create({
          ...item,
          invoice: savedInvoice, // Link to the created invoice
        }),
      );

      await this.invoiceItemRepository.save(invoiceItems); // Save all items
    }

    // Fetch the invoice with items to return
    return this.invoiceRepository.findOne({
      where: { id: savedInvoice.id },
      relations: ['customer', 'branch', 'currency', 'items'], // Include related entities
    });
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      relations: ['customer', 'branch', 'currency', 'items'],
    });
  }

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
