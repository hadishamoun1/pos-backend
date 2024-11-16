import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  Patch,
} from '@nestjs/common';
import { PurchaseInvoiceService } from './purchases-invoice.service';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';

@Controller('purchase-invoices')
export class PurchaseInvoiceController {
  constructor(
    private readonly purchaseInvoiceService: PurchaseInvoiceService,
  ) {}

  @Post()
  async create(@Body() createPurchaseInvoiceDto: CreatePurchaseInvoiceDto) {
    return this.purchaseInvoiceService.create(createPurchaseInvoiceDto);
  }

  @Get()
  async findAll() {
    return this.purchaseInvoiceService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    return this.purchaseInvoiceService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() updateData) {
    return this.purchaseInvoiceService.update(id, updateData);
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    return this.purchaseInvoiceService.remove(id);
  }
}
