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

  // Create multiple Payment Vouchers
  @Post('v1/bulk')
  async createMultiplePaymentVouchers(
    @Body()
    transactions: {
      customerId: number;
      date: Date;
      details: {
        cashNumber: string;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required for "LL"
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
