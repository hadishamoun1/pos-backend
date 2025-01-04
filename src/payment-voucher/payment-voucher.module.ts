import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucherController } from './payment-voucher.controller';
import { Customer } from '../entities/customer.entity';
import { Supplier } from 'src/entities/supplier.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      PaymentVoucher,
      PaymentVoucherDetail,
      Account,
      CurrencyRate,
      Customer,
    ]),
  ],
  providers: [PaymentVoucherService],
  controllers: [PaymentVoucherController],
})
export class PaymentVoucherModule {}
