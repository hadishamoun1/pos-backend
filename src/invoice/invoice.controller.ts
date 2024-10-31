import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { Invoice } from '../entities/invoice.entity';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async createInvoice(@Body() data: Partial<Invoice>): Promise<Invoice> {
    return await this.invoiceService.createInvoice(data);
  }

  @Get(':id')
  async findOne(@Param('id') id: number): Promise<Invoice> {
    return await this.invoiceService.findOne(id);
  }

  @Get()
  async findAll(): Promise<Invoice[]> {
    return await this.invoiceService.findAll();
  }
}
