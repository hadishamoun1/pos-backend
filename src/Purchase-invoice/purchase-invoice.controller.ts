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
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity.ts';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

import { RecomputeCostsService } from '../recomputeTransfersAndPurchases/recompute.service';

@Controller('purchase-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseInvoiceController {
     
  constructor(
    private readonly service: PurchaseInvoiceService,
    private readonly recompute: RecomputeCostsService,
  ) {}

    private startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

@Post()
  @RequirePerms('purchases.create')
  async create(@Body() body: any) {
    const created = await this.service.create(body);

    // ✅ only recompute if this purchase affects inventory/costs
    if ((created as any)?.status === 'Recieved') {
      const cut = this.startOfDay(new Date((created as any).date));
      await this.recompute.recomputeFromDate(cut);
    }

    return created;
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

  // GET /purchase-invoices/cost-analysis/history
  @Get('cost-analysis/history')
  @RequirePerms('purchases.view')
  getCostAnalysisHistory() {
    return this.service.getCostAnalysisHistory();
  }

  // GET /purchase-invoices/cost-analysis/real-description-history?q=...
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
  // ✅ read BEFORE update (date)
  const before = await this.service.findOne(id);

  const updated = await this.service.update(id, body);

  // ✅ ALWAYS recompute (your request)
  const oldDate = before?.date
    ? new Date((before as any).date)
    : new Date((updated as any).date);

  const newDate = new Date((updated as any).date);

  const cut = (() => {
    const d = oldDate <= newDate ? oldDate : newDate;
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  await this.recompute.recomputeFromDate(cut);

  return updated;
}

}
