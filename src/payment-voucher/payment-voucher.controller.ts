import {
  Controller,
  Post,
  Get,
  Body,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Delete,
  HttpCode,
  ParseIntPipe,
  Query,
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
    return this.paymentVoucherService.getFilteredPaymentVouchers();
  }
  @Delete(':id')
  @HttpCode(204) // No content
  async deletePaymentVoucher(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.paymentVoucherService.deletePaymentVoucher(id);
  }

  @Get('v1/filter')
  async filterPaymentVouchers(
    @Query('supplierId') supplierId?: number,
    @Query('date') date?: string,
    @Query('paymentType') paymentType?: string,
    @Query('pmNumber') pmNumber?: string,
    @Query('exchangeRate') exchangeRate?: number,
    @Query('amount') amount?: number,
    @Query('type') type?: string,
    @Query('page') page: number = 1, // Default to page 1
    @Query('limit') limit: number = 10, // Default to 10 items per page
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const filters = {
      supplierId,
      date,
      paymentType,
      pmNumber,
      exchangeRate,
      amount,
      type,
    };

    return this.paymentVoucherService.filterPaymentVouchers(
      filters,
      page,
      limit,
    );
  }
}
