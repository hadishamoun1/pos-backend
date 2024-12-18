import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity';
import { SalesVoucherDetail } from '../entities/Vouchers/salesVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { SalesVoucherService } from './sales-voucher.service';
import { SalesVoucherController } from './sales-voucher.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesVoucher,
      SalesVoucherDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  controllers: [SalesVoucherController],
  providers: [SalesVoucherService],
  exports: [SalesVoucherService],
})
export class SalesVoucherModule {}
