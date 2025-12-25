// src/transfers/transfers.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { Transfer } from '../entities/inventory/transfer.entity';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';
import { RecomputeCostsService } from 'src/recomputeTransfersAndPurchases/recompute.service';


@Controller('transfers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TransfersController {
  constructor(private readonly svc: TransfersService,
        private readonly recompute: RecomputeCostsService,

  ) {}

  @Post()
  @RequirePerms('transfers.create')
  async create(@Body() body: any): Promise<Transfer[]> {
    const res = await this.svc.create(body);

    // ✅ recompute from transfer date (fallback: today)
    const fromDate = body?.date || new Date().toISOString().slice(0, 10);
    await this.recompute.recomputeFromDate(fromDate);

    return res;
  }
  
  @Get('v1/details')
  @RequirePerms('transfers.view')
  async findDetails() {
    const raws = await this.svc.finddetails();
    return raws.map((t) => ({
      id: t.id,
      transferNumber: t.transferNumber,
      date: t.date,
      type: t.type,
      location: t.location,
      createdAt: t.createdAt,
      items: t.items.map((i) => {
        const variant = i.itemBatch?.itemVariant;
        const thickness = variant?.thickness;
        const item = thickness?.item;

        return {
          id: i.id,
          transferId: i.transferId,
          itemVariantId: variant?.id || null,
          quantity: i.quantity,
          sqm: i.sqm,
          price: i.price,
          length: variant?.length || 0,
          width: variant?.width || 0,
          sheetsPerBox: variant?.sheetsPerBox || 0,
          origin: variant?.origin || '',
          thickness: thickness?.thickness || '',
          itemName: item?.itemName || '',
          itemType: item?.type || '',
        };
      }),
    }));
  }

  // GET /transfers/v1/cuts?page=1&limit=50&status=pending&from=...&to=...&q=...
  @Get('v1/cuts')
  @RequirePerms('cuts.view')
  async getCuts(@Query() query: any) {
    return this.svc.getCutsQueue({
      page: query.page,
      limit: query.limit,
      status: query.status,
      from: query.from,
      to: query.to,
      q: query.q,
    });
  }

  @Get('v1/dim-changes')
  @RequirePerms('transfers.view')
  async getInvoiceDimChanges(@Query() q: any) {
    return this.svc.getInvoiceDimChanges({
      page: q.page,
      limit: q.limit,
      q: q.q,
    });
  }

  @Get()
  @RequirePerms('transfers.view')
  findAll(): Promise<Transfer[]> {
    return this.svc.findAll();
  }

  @Get(':id')
  @RequirePerms('transfers.view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Transfer> {
    return this.svc.findOne(id);
  }

  @Patch(':id')
  @RequirePerms('transfers.update')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const updated = await this.svc.updateTransfer(id, body);

    // ✅ recompute from updated transfer date (fallback: body.date)
    const fromDate = updated?.date || body?.date || new Date().toISOString().slice(0, 10);
    await this.recompute.recomputeFromDate(fromDate);

    return updated;
  }

  @Delete(':id')
  @RequirePerms('transfers.delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.svc.remove(id);
    return { success: true };
  }
}
