import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  ParseIntPipe,
} from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity.ts';

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

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: Partial<PurchaseInvoice> & {
      items?: Partial<PurchaseInvoiceItem>[];
      unitPriceRows?: Partial<UnitPriceModalRow>[];
    },
  ) {
    return this.service.update(id, body);
  }
}
