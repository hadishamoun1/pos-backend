import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
  } from '@nestjs/common';
  import { PaymentVoucherReturnService } from './payment-voucher-return.service';
  import { PaymentVoucherReturn } from '../entities/returnVouchers/paymentVoucherReturn.entity';
  
  @Controller('payment-voucher-returns')
  export class PaymentVoucherReturnController {
    constructor(
      private readonly paymentVoucherReturnService: PaymentVoucherReturnService,
    ) {}
  
    @Post()
    create(
      @Body() data: Partial<PaymentVoucherReturn>,
    ): Promise<PaymentVoucherReturn> {
      return this.paymentVoucherReturnService.createPaymentVoucherReturn(data);
    }
  
    @Get()
    getAll(): Promise<PaymentVoucherReturn[]> {
      return this.paymentVoucherReturnService.getAllPaymentVoucherReturns();
    }
  
    @Get(':id')
    getById(@Param('id') id: number): Promise<PaymentVoucherReturn> {
      return this.paymentVoucherReturnService.getPaymentVoucherReturnById(id);
    }
  
    @Put(':id')
    update(
      @Param('id') id: number,
      @Body() data: Partial<PaymentVoucherReturn>,
    ): Promise<PaymentVoucherReturn> {
      return this.paymentVoucherReturnService.updatePaymentVoucherReturn(
        id,
        data,
      );
    }
  
    @Delete(':id')
    delete(@Param('id') id: number): Promise<void> {
      return this.paymentVoucherReturnService.deletePaymentVoucherReturn(id);
    }
  }
  