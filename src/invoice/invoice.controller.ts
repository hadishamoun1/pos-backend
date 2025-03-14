import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { Invoice } from '../entities/invoice.entity';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async createInvoice(@Body() invoiceData: Partial<Invoice>): Promise<Invoice> {
    return this.invoiceService.createInvoice(invoiceData);
  }

  @Get()
  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceService.getAllInvoices();
  }

  @Get('v1/:id')
  async getInvoiceById(@Param('id') id: number): Promise<Invoice> {
    return this.invoiceService.getInvoiceById(id);
  }

  @Get('filtered')
  async getFilteredInvoices() {
    return this.invoiceService.getFilteredInvoices();
  }
}
