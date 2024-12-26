import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { ReceiptVoucher } from '../entities/Vouchers/recieptVoucher.entity';

@Controller('receipt-vouchers')
export class ReceiptVoucherController {
  constructor(private readonly receiptVoucherService: ReceiptVoucherService) {}

  // Create a new Receipt Voucher
  // Create a new Receipt Voucher
  @Post()
  async createReceiptVoucher(
    @Body()
    data: {
      customerAccountId: number;
      date: Date;
      rvNumber: string;
      details: {
        cashNumber: string;
        currency: string; // Used to determine USD or LL
      }[];
    },
  ): Promise<ReceiptVoucher> {
    try {
      return await this.receiptVoucherService.createReceiptVoucher(data);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  // Get all Receipt Vouchers
  @Get()
  async getAllReceiptVouchers(): Promise<ReceiptVoucher[]> {
    try {
      return await this.receiptVoucherService.getAllReceiptVouchers();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get a single Receipt Voucher by ID
  @Get(':id')
  async getReceiptVoucherById(
    @Param('id') id: number,
  ): Promise<ReceiptVoucher> {
    try {
      return await this.receiptVoucherService.getReceiptVoucherById(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  // Update a Receipt Voucher
  @Put(':id')
  async updateReceiptVoucher(
    @Param('id') id: number,
    @Body()
    data: Partial<ReceiptVoucher> & { customerAccountId?: number },
  ): Promise<ReceiptVoucher> {
    try {
      return await this.receiptVoucherService.updateReceiptVoucher(id, data);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  // Delete a Receipt Voucher
  @Delete(':id')
  async deleteReceiptVoucher(@Param('id') id: number): Promise<void> {
    try {
      await this.receiptVoucherService.deleteReceiptVoucher(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }
  @Post('v1/bulk')
  async createMultipleReceiptVouchers(
    @Body()
    transactions: {
      customerAccountId: number;
      date: Date;
      invoiceId: string;
      details: {
        cashNumber: string;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required for "LL"
        comments?: string; // Optional comments
      }[];
    }[],
  ): Promise<{ message: string; vouchers: ReceiptVoucher[] }> {
    try {
      const vouchers =
        await this.receiptVoucherService.createMultipleReceiptVouchers(
          transactions,
        );

      return {
        message: 'Receipt vouchers created successfully.',
        vouchers,
      };
    } catch (error) {
      throw new HttpException(
        { message: 'Failed to create receipt vouchers.', error: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  @Get('v1/specific-fields')
  async getSpecificFields() {
    return this.receiptVoucherService.getSpecificFields();
  }
}
