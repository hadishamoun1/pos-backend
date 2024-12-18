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
} from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';

@Controller('payment-vouchers')
export class PaymentVoucherController {
  constructor(private readonly paymentVoucherService: PaymentVoucherService) {}

  // Create a new Payment Voucher
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPaymentVoucher(
    @Body() data: Partial<PaymentVoucher>,
  ): Promise<PaymentVoucher> {
    return this.paymentVoucherService.createPaymentVoucher(data);
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
