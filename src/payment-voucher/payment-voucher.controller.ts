import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';

@Controller('payment-vouchers')
export class PaymentVoucherController {
  constructor(private readonly paymentVoucherService: PaymentVoucherService) {}

  @Post('bulk')
  async createMultiplePaymentVouchers(
    @Body()
    transactions: {
      customerId: number;
      date: Date;
      invoiceId: string;
      details: {
        cashNumber: string;
        currency: string;
        exchangeRate?: string;
        description?: string;
      }[];
    }[],
  ): Promise<PaymentVoucher[]> {
    try {
      return await this.paymentVoucherService.createMultiplePaymentVouchers(
        transactions,
      );
    } catch (error) {
      throw new HttpException(
        { message: 'Failed to create payment vouchers.', error: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
