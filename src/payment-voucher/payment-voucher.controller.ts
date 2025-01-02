import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  HttpException
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
      accountId: number; // Main account for the voucher
      date: Date;
      pmNumber: string; // Payment voucher number
      details: {
        cashNumber: string;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required for "LL"
        amountExchanged?: string; // Explicitly for LL
        description?: string; // Optional description
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

  // Get all Payment Vouchers
  @Get()
  async getAllPaymentVouchers(): Promise<PaymentVoucher[]> {
    return this.paymentVoucherService.getAllPaymentVouchers();
  }

  // Get a single Payment Voucher by ID
  @Get(':id')
  async getPaymentVoucherById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PaymentVoucher> {
    return this.paymentVoucherService.getPaymentVoucherById(id);
  }

  // Update a Payment Voucher by ID
  @Put(':id')
  async updatePaymentVoucher(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: Partial<PaymentVoucher>,
  ): Promise<PaymentVoucher> {
    return this.paymentVoucherService.updatePaymentVoucher(id, data);
  }

  // Delete a Payment Voucher by ID
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePaymentVoucher(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.paymentVoucherService.deletePaymentVoucher(id);
  }
}
