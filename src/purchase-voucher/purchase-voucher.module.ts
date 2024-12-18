import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { PurchaseVoucherDetail } from '../entities/Vouchers/purchaseVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { PurchaseVoucherService } from './purchase-voucher.service';
import { PurchaseVoucherController } from './purchase-voucher.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseVoucher,
      PurchaseVoucherDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  controllers: [PurchaseVoucherController],
  providers: [PurchaseVoucherService],
})
export class PurchaseVoucherModule {}
