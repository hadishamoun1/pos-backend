import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucherController } from './payment-voucher.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentVoucher,
      PaymentVoucherDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [PaymentVoucherService],
  controllers: [PaymentVoucherController],
})
export class PaymentVoucherModule {}
