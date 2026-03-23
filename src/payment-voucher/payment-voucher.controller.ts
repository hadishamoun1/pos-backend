import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentType, VoucherType } from '../entities/Vouchers/paymentVoucher.entity';

@Controller('payment-vouchers')
export class PaymentVoucherController {
  constructor(private readonly paymentVoucherService: PaymentVoucherService) {}

  // GET /payment-vouchers/v1/formatted
  @Get('v1/formatted')
  getFormatted() {
    return this.paymentVoucherService.getFormatted();
  }

  // GET /payment-vouchers/v1/filter?supplierId=&date=&paymentType=&paymentNumber=&amount=&type=&page=&limit=
  @Get('v1/filter')
  getFiltered(
    @Query('supplierId') supplierId?: number,
    @Query('date') date?: string,
    @Query('paymentType') paymentType?: PaymentType,
    @Query('paymentNumber') paymentNumber?: string,
    @Query('amount') amount?: number,
    @Query('type') type?: VoucherType,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.paymentVoucherService.getFiltered(
      { supplierId, date, paymentType, paymentNumber, amount, type },
      Number(page),
      Number(limit),
    );
  }

  // POST /payment-vouchers/v1/bulk
  @Post('v1/bulk')
  createBulk(@Body() body: any[]) {
    return this.paymentVoucherService.createBulk(body);
  }

  // PATCH /payment-vouchers/:id
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.paymentVoucherService.update(id, body);
  }

  // DELETE /payment-vouchers/:id
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.paymentVoucherService.remove(id);
  }
}