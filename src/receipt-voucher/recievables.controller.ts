// src/receipt-voucher/recievables.controller.ts
import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Param,
  ParseIntPipe,
  Delete,
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
      invoiceId?: string;
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
      invoiceId?: string;
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


   @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.service.delete(id);
  }
}
