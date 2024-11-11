// purchaseInvoice.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { PurchaseInvoiceService } from './purchases-invoice.service';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';

@Controller('purchase-invoices')
export class PurchaseInvoiceController {
  constructor(
    private readonly purchaseInvoiceService: PurchaseInvoiceService,
  ) {}

  @Post()
  async createPurchaseInvoice(@Body() data: any): Promise<PurchaseInvoice> {
    return this.purchaseInvoiceService.createPurchaseInvoice(data);
  }
}
