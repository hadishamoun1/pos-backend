import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { Supplier } from '../entities/supplier.entity';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucherController } from './payment-voucher.controller';
import { SettingsService } from '../settings/settings.service';
import { Settings } from '../entities/settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentVoucher, PaymentVoucherDetail, Supplier, Settings])],
  controllers: [PaymentVoucherController],
  providers: [PaymentVoucherService, SettingsService],
  exports: [PaymentVoucherService],
})
export class PaymentVoucherModule {}