import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesReturnVoucher } from '../entities/returnVouchers/salesReturnVoucher.entity';
import { SalesReturnVoucherDetail } from '../entities/returnVouchers/salesReturnVoucherDetails.entity';
import { SalesReturnVoucherService } from './sales-return-voucher.service';
import { SalesReturnVoucherController } from './sales-return-voucher.controller';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesReturnVoucher,
      SalesReturnVoucherDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [SalesReturnVoucherService],
  controllers: [SalesReturnVoucherController],
})
export class SalesReturnVoucherModule {}
