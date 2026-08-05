// src/receipt-voucher/recievables.controller.ts
import {
  Controller,
  Post,
  Put,
  Patch,
  Get,
  Body,
  Param,
  ParseIntPipe,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RecievablesService } from './recievables.service';
import { ReceiptEntry } from '../entities/recievables.entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('recievables')
export class RecievablesController {
  constructor(private readonly service: RecievablesService) {}

  @Post()
  create(
    @Body()
    body: {
      customerId: number;
      date: string; // ISO date
      invoiceId?: number | null;
      cashNumber: number;
      currency: 'USD' | 'LL';
      exchangeRate?: number;
      amountExchanged: number;
      comments?: string;
      type: 'G' | 'S' | 'RVR';
      pmtType: 'Cash' | 'Check';
    },
  ): Promise<ReceiptEntry> {
    return this.service.create({
      ...body,
      date: new Date(body.date),
    });
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      customerId: number;
      date: string; // ISO date
      invoiceId?: number | null;
      cashNumber: number;
      currency: 'USD' | 'LL';
      exchangeRate?: number;
      amountExchanged: number;
      comments?: string;
      type: 'G' | 'S' | 'RVR';
      pmtType: 'Cash' | 'Check';
    },
  ): Promise<ReceiptEntry> {
    return this.service.update(id, {
      ...body,
      date: new Date(body.date),
    });
  }

  @Get('v1/summary')
  getSummary(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('customer') customer?: string,
    @Query('cashNumber') cashNumber?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('type') type?: string,
  ) {
    if (limit) {
      return this.service.findSummaryPaginated(
        Number(limit),
        Number(offset ?? '0'),
        {
          customer: customer?.trim() || undefined,
          cashNumber: cashNumber?.trim() || undefined,
          dateFrom: dateFrom?.trim() || undefined,
          dateTo: dateTo?.trim() || undefined,
          type: type?.trim() || undefined,
        },
      );
    }
    return this.service.findSummary();
  }

  // RVR-Receivables-page-only action: gated separately since GET v1/summary
  // above is shared with the general (unguarded) Receivables page.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('rvrRecievables.view')
  @Patch(':id/link-invoice')
  linkInvoice(
    @Param('id', ParseIntPipe) id: number,
    @Body('invoiceId', ParseIntPipe) invoiceId: number,
  ) {
    return this.service.linkInvoiceToReceivable(id, invoiceId);
  }


 @Get('v1/customers/:customerId/invoices')
  async getCustomerInvoicesForReceivables(
    @Param('customerId') customerId: string,
    @Query('q') q?: string,
    @Query('type') type?: 'S' | 'G' | 'RVR' | 'RTN' | 'ALL',
    @Query('from') from?: string, 
    @Query('to') to?: string,    
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listInvoicesForReceivablesByCustomer({
      customerId: Number(customerId),
      q,
      type: (type as any) ?? 'ALL',
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }
@Get(':id/journal-voucher')
async getJournalVoucher(@Param('id', ParseIntPipe) id: number) {
  return await this.service.getJournalVoucherForReceiptEntry(id);
}
// Add this method to your RecievablesController class

@Get('daily')
async getDailyReceivables(
  @Query('date') date: string,
  @Query('type') type?: 'G' | 'S' | 'ALL' | 'RVR',
  @Query('pmtType') pmtType?: 'Cash' | 'Check' | 'ALL',
) {
  return this.service.getDailyReceivables({
    date,
    type: type || 'ALL',
    pmtType: pmtType || 'ALL',
  });
}

  @Get('sequence-audit')
  sequenceAudit(@Query('year') year?: string) {
    const yy = year ? String(year).slice(-2) : String(new Date().getFullYear()).slice(-2);
    return this.service.sequenceAudit(yy);
  }

  @Patch(':id/fix-jv-number')
  fixJvNumber(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { jvNumber: string },
  ) {
    return this.service.fixJvNumber(id, body.jvNumber.trim());
  }

  @Get('filtered')
  getFiltered(
    @Query('type') type: 'S' | 'RVR',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findFiltered({
      type,
      from,
      to,
      limit: limit ? Number(limit) : 500,
    });
  }

  @Patch(':id/convert-type')
  convertType(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { newType: 'S' | 'RVR' },
  ) {
    return this.service.convertReceivableType(id, body.newType);
  }

   @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.service.delete(id);
  }
}
