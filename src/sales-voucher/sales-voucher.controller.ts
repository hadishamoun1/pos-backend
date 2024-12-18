import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { SalesVoucherService } from './sales-voucher.service';
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity';

@Controller('sales-vouchers')
export class SalesVoucherController {
  constructor(private readonly salesVoucherService: SalesVoucherService) {}

  // Create a new Sales Voucher
  @Post()
  async createSalesVoucher(
    @Body() data: Partial<SalesVoucher>,
  ): Promise<SalesVoucher> {
    return this.salesVoucherService.createSalesVoucher(data);
  }

  // Get all Sales Vouchers
  @Get()
  async getAllSalesVouchers(): Promise<SalesVoucher[]> {
    return this.salesVoucherService.getAllSalesVouchers();
  }

  // Get a single Sales Voucher by ID
  @Get(':id')
  async getSalesVoucherById(@Param('id') id: number): Promise<SalesVoucher> {
    const salesVoucher = await this.salesVoucherService.getSalesVoucherById(id);
    if (!salesVoucher) {
      throw new NotFoundException(`Sales Voucher with ID ${id} not found.`);
    }
    return salesVoucher;
  }

  // Update a Sales Voucher
  @Put(':id')
  async updateSalesVoucher(
    @Param('id') id: number,
    @Body() data: Partial<SalesVoucher>,
  ): Promise<SalesVoucher> {
    return this.salesVoucherService.updateSalesVoucher(id, data);
  }

  // Delete a Sales Voucher
  @Delete(':id')
  async deleteSalesVoucher(@Param('id') id: number): Promise<void> {
    await this.salesVoucherService.deleteSalesVoucher(id);
  }
}
