
import { Controller, Post, Body, Get } from '@nestjs/common';
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
}