import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseReturnVoucher } from '../entities/returnVouchers/purchaseReturnVoucher.entity';
import { PurchaseReturnVoucherDetail } from '../entities/returnVouchers/purchaseReturnVoucherDetails.entity';
import { PurchaseReturnVoucherService } from './purchase-return-voucher.service';
import { PurchaseReturnVoucherController } from './purchase-return-voucher.controller';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseReturnVoucher,
      PurchaseReturnVoucherDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [PurchaseReturnVoucherService],
  controllers: [PurchaseReturnVoucherController],
})
export class PurchaseReturnVoucherModule {}
