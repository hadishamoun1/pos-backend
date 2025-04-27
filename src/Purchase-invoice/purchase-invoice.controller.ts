import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';

@Controller('purchase-invoices')
export class PurchaseInvoiceController {
  constructor(private readonly service: PurchaseInvoiceService) {}

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Get()
  getAll() {
    return this.service.findAll();
  }

  @Get('v1/minimal')
  getMinimalInvoices() {
    return this.service.findMinimalInvoices();
  }
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.findOne(+id);
  }
}
