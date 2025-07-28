import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Put,
  ParseIntPipe,
} from '@nestjs/common';
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
  @Get('v1/browsing/:customerId')
  async getBrowsing(
    @Param('customerId') customerId: number,
    @Query('groupKey') groupKey?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 5,
  ) {
    return this.invoiceService.getBrowsingInvoices(
      customerId,
      limit,
      page,
      groupKey,
    );
  }

  @Get('v1/:id')
  async getInvoiceById(@Param('id') id: number): Promise<Invoice> {
    return this.invoiceService.getInvoiceById(id);
  }

  @Get('filtered')
  async getFilteredInvoices(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 100,
  ) {
    return this.invoiceService.getFilteredInvoices(Number(page), Number(limit));
  }

  @Put(':id')
  async editInvoice(
    @Param('id') invoiceId: number,
    @Body() invoiceData: Partial<Invoice>,
  ) {
    return this.invoiceService.editInvoice(invoiceId, invoiceData);
  }
}
