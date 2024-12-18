import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
  } from '@nestjs/common';
  import { PurchaseReturnVoucherService } from './purchase-return-voucher.service';
  import { PurchaseReturnVoucher } from '../entities/returnVouchers/purchaseReturnVoucher.entity';
  
  @Controller('purchase-return-vouchers')
  export class PurchaseReturnVoucherController {
    constructor(
      private readonly purchaseReturnVoucherService: PurchaseReturnVoucherService,
    ) {}
  
    @Post()
    create(
      @Body() data: Partial<PurchaseReturnVoucher>,
    ): Promise<PurchaseReturnVoucher> {
      return this.purchaseReturnVoucherService.createPurchaseReturnVoucher(data);
    }
  
    @Get()
    getAll(): Promise<PurchaseReturnVoucher[]> {
      return this.purchaseReturnVoucherService.getAllPurchaseReturnVouchers();
    }
  
    @Get(':id')
    getById(@Param('id') id: number): Promise<PurchaseReturnVoucher> {
      return this.purchaseReturnVoucherService.getPurchaseReturnVoucherById(id);
    }
  
    @Put(':id')
    update(
      @Param('id') id: number,
      @Body() data: Partial<PurchaseReturnVoucher>,
    ): Promise<PurchaseReturnVoucher> {
      return this.purchaseReturnVoucherService.updatePurchaseReturnVoucher(id, data);
    }
  
    @Delete(':id')
    delete(@Param('id') id: number): Promise<void> {
      return this.purchaseReturnVoucherService.deletePurchaseReturnVoucher(id);
    }
  }
  