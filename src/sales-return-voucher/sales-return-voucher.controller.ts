import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { SalesReturnVoucherService } from './sales-return-voucher.service';
import { SalesReturnVoucher } from '../entities/returnVouchers/salesReturnVoucher.entity';

@Controller('sales-return-vouchers')
export class SalesReturnVoucherController {
  constructor(
    private readonly salesReturnVoucherService: SalesReturnVoucherService,
  ) {}

  @Post()
  create(
    @Body() data: Partial<SalesReturnVoucher>,
  ): Promise<SalesReturnVoucher> {
    return this.salesReturnVoucherService.createSalesReturnVoucher(data);
  }

  @Get()
  getAll(): Promise<SalesReturnVoucher[]> {
    return this.salesReturnVoucherService.getAllSalesReturnVouchers();
  }

  @Get(':id')
  getById(@Param('id') id: number): Promise<SalesReturnVoucher> {
    return this.salesReturnVoucherService.getSalesReturnVoucherById(id);
  }

  @Put(':id')
  update(
    @Param('id') id: number,
    @Body() data: Partial<SalesReturnVoucher>,
  ): Promise<SalesReturnVoucher> {
    return this.salesReturnVoucherService.updateSalesReturnVoucher(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: number): Promise<void> {
    return this.salesReturnVoucherService.deleteSalesReturnVoucher(id);
  }
}
