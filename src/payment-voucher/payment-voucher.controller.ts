import {
  Controller,
  Post,
  HttpException,
  HttpStatus,
  Body,
} from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';

@Controller('payment-vouchers')
export class PaymentVoucherController {
  constructor(private readonly paymentVoucherService: PaymentVoucherService) {}

  @Post('v1/bulk')
  async createMultiplePaymentVouchers(
    @Body()
    transactions: {
      supplierId: number; // Changed from customerId to supplierId
      date: Date;
      invoiceId: string;
      details: {
        amount: number;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required for "LL"
        checkNumber?: string;
        bankName?: string;
        description?: string;
        paymentNumber: string;
        type: string; // "S" or "G"
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
