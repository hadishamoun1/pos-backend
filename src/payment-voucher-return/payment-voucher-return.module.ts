import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentVoucherReturn } from '../entities/returnVouchers/paymentVoucherReturn.entity';
import { PaymentVoucherReturnDetail } from '../entities/returnVouchers/paymentVoucherReturnDetails.entity';
import { PaymentVoucherReturnService } from './payment-voucher-return.service';
import { PaymentVoucherReturnController } from './payment-voucher-return.controller';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentVoucherReturn,
      PaymentVoucherReturnDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [PaymentVoucherReturnService],
  controllers: [PaymentVoucherReturnController],
})
export class PaymentVoucherReturnModule {}
