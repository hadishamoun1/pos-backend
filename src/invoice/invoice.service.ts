import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly settingsService: SettingsService,
  ) {}

  // Method to create a new invoice
  async createInvoice(data: Partial<Invoice>): Promise<Invoice> {
    try {
      const activeYear = await this.settingsService.getActiveYear();
      data.invoiceYear = activeYear;
      const invoice = this.invoiceRepository.create(data);
      return await this.invoiceRepository.save(invoice);
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'Duplicate invoice number within this type',
        );
      }
      throw error;
    }
  }

  // Method to find one invoice by ID
  async findOne(id: number): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return invoice;
  }

  // Method to retrieve all invoices
  async findAll(): Promise<Invoice[]> {
    return await this.invoiceRepository.find();
  }

  // Optional: Method to delete an invoice by ID
  async deleteInvoice(id: number): Promise<void> {
    const result = await this.invoiceRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
  }
}
