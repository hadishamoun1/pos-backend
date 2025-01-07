import {
  Controller,
  Post,
  Get,
  Body,
  HttpException,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';

@Controller('payment-vouchers')
export class PaymentVoucherController {
  constructor(private readonly paymentVoucherService: PaymentVoucherService) {}

  /**
   * Create multiple payment vouchers
   * @param transactions - Array of payment voucher objects
   */
  @Post('v1/bulk')
  async createMultiplePaymentVouchers(
    @Body()
    transactions: {
      supplierId: number;
      date: Date;
      invoiceId: string;
      paymentType: string;
      type: string; // "S" or "G"
      doneBy: string;
      details: {
        amount: number;
        currency: string;
        exchangeRate?: string;
        checkNumber?: string;
        checkDate?: Date;
        checkDueDate?: Date;
        bankName?: string;
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
        {
          message: 'Failed to create payment vouchers.',
          error: error.message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  editPaymentVoucher(
    @Param('id') id: number,
    @Body()
    updateData: {
      supplierId?: number;
      date?: Date;
      invoiceId?: string;
      paymentType?: string;
      type?: string;
      doneBy?: string;
      details?: {
        amount: number;
        currency: string;
        exchangeRate?: string;
        checkNumber?: string;
        checkDate?: Date;
        checkDueDate?: Date;
        bankName?: string;
        description?: string;
      }[];
    },
  ): Promise<PaymentVoucher> {
    return this.paymentVoucherService.editPaymentVoucher(id, updateData);
  }

  @Get('v1/formatted')
  async getFormattedPaymentVouchers(): Promise<any[]> {
    return this.paymentVoucherService.getFormattedPaymentVouchers();
  }
}
