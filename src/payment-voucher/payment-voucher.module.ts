import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Supplier } from '../entities/supplier.entity';
import { Account } from '../entities/account.entity';
import { Settings } from '../entities/settings.entity';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucherController } from './payment-voucher.controller';
import { SettingsService } from '../settings/settings.service';
import { AccountingModule } from '../accountRoleMap/accounting.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentVoucher,
      PaymentVoucherDetail,
      JournalVoucher,
      JournalVoucherDetail,
      Supplier,
      Account,
      Settings,
    ]),
    AccountingModule, // provides AccountingResolverService
  ],
  controllers: [PaymentVoucherController],
  providers: [PaymentVoucherService, SettingsService],
  exports: [PaymentVoucherService],
})
export class PaymentVoucherModule {}