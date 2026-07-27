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
} from '@nestjs/common';
import { RecievablesService } from './recievables.service';
import { ReceiptEntry } from '../entities/recievables.entities';

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
  getSummary() {
    return this.service.findSummary();
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
