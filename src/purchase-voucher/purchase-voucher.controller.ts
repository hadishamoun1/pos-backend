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
  import { PurchaseVoucherService } from './purchase-voucher.service';
  import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
  
  @Controller('purchase-vouchers')
  export class PurchaseVoucherController {
    constructor(private readonly purchaseVoucherService: PurchaseVoucherService) {}
  
    // Create a new Purchase Voucher
    @Post()
    async createPurchaseVoucher(@Body() data: Partial<PurchaseVoucher>): Promise<PurchaseVoucher> {
      return this.purchaseVoucherService.createPurchaseVoucher(data);
    }
  
    // Get all Purchase Vouchers
    @Get()
    async getAllPurchaseVouchers(): Promise<PurchaseVoucher[]> {
      return this.purchaseVoucherService.getAllPurchaseVouchers();
    }
  
    // Get a single Purchase Voucher by ID
    @Get(':id')
    async getPurchaseVoucherById(@Param('id') id: number): Promise<PurchaseVoucher> {
      const purchaseVoucher = await this.purchaseVoucherService.getPurchaseVoucherById(id);
      if (!purchaseVoucher) {
        throw new NotFoundException(`Purchase Voucher with ID ${id} not found.`);
      }
      return purchaseVoucher;
    }
  
    // Update a Purchase Voucher
    @Put(':id')
    async updatePurchaseVoucher(
      @Param('id') id: number,
      @Body() data: Partial<PurchaseVoucher>,
    ): Promise<PurchaseVoucher> {
      return this.purchaseVoucherService.updatePurchaseVoucher(id, data);
    }
  
    // Delete a Purchase Voucher
    @Delete(':id')
    async deletePurchaseVoucher(@Param('id') id: number): Promise<void> {
      await this.purchaseVoucherService.deletePurchaseVoucher(id);
    }
  }
  