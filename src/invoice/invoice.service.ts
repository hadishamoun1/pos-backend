import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { SettingsService } from './settings.service';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly settingsService: SettingsService,
  ) {}

  async createInvoice(data: Partial<Invoice>): Promise<Invoice> {
    try {
      // Step 1: Get active year prefix from Settings
      const activeYear = await this.settingsService.getActiveYear();

      // Step 2: Set the invoiceYear to the active year prefix
      data.invoiceYear = activeYear;

      // Step 3: Save the invoice
      const invoice = this.invoiceRepository.create(data);
      return await this.invoiceRepository.save(invoice);

    } catch (error) {
      if (error.code === '23505') { // Handle duplicate error
        throw new ConflictException('Duplicate invoice number within this type');
      }
      throw error;
    }
  }
}
