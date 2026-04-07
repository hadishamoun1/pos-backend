import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity';
// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('purchase-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseInvoiceController {

  constructor(
    private readonly service: PurchaseInvoiceService,
  ) {}

  @Post()
  @RequirePerms('purchases.create')
  async create(@Body() body: any) {
    return this.service.create(body);
  }

  @Get()
  @RequirePerms('purchases.view')
  getAll() {
    return this.service.findAll();
  }

  @Get('v1/minimal')
  @RequirePerms('purchases.view')
  getMinimalInvoices() {
    return this.service.findMinimalInvoices();
  }

  @Get('cost-analysis/history')
  @RequirePerms('purchases.view')
  getCostAnalysisHistory(@Query('q') q?: string) {
    return this.service.getCostAnalysisHistory(q);
  }

  @Get('cost-analysis/real-description-history')
  @RequirePerms('purchases.view')
  getRealDescHistory(@Query('q') q?: string) {
    return this.service.getRealDescriptionCostHistory(q);
  }

  @Get(':id')
  @RequirePerms('purchases.view')
  getOne(@Param('id') id: string) {
    return this.service.findOne(+id);
  }

  @Get(':id/journal-vouchers')
  async getJournalVouchers(@Param('id', ParseIntPipe) id: number) {
    return this.service.getJournalVouchersForInvoice(id);
  }

  @Put(':id')
  @RequirePerms('purchases.update')
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