import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ReceiptVoucherReturnService } from './receipt-voucher-return.service';
import { ReceiptVoucherReturn } from '../entities/returnVouchers/receiptVoucherReturn.entity';

@Controller('receipt-voucher-returns')
export class ReceiptVoucherReturnController {
  constructor(
    private readonly receiptVoucherReturnService: ReceiptVoucherReturnService,
  ) {}

  @Post()
  create(
    @Body() data: Partial<ReceiptVoucherReturn>,
  ): Promise<ReceiptVoucherReturn> {
    return this.receiptVoucherReturnService.createReceiptVoucherReturn(data);
  }

  @Get()
  getAll(): Promise<ReceiptVoucherReturn[]> {
    return this.receiptVoucherReturnService.getAllReceiptVoucherReturns();
  }

  @Get(':id')
  getById(@Param('id') id: number): Promise<ReceiptVoucherReturn> {
    return this.receiptVoucherReturnService.getReceiptVoucherReturnById(id);
  }

  @Put(':id')
  update(
    @Param('id') id: number,
    @Body() data: Partial<ReceiptVoucherReturn>,
  ): Promise<ReceiptVoucherReturn> {
    return this.receiptVoucherReturnService.updateReceiptVoucherReturn(
      id,
      data,
    );
  }

  @Delete(':id')
  delete(@Param('id') id: number): Promise<void> {
    return this.receiptVoucherReturnService.deleteReceiptVoucherReturn(id);
  }
}
