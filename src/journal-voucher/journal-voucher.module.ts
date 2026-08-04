import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { JournalVoucherService } from './journal-voucher.service';
import { JournalVoucherController } from './journal-voucher.controller';
import { Customer } from '../entities/customer.entity';
import { Settings } from '../entities/settings.entity';
import { Supplier } from '../entities/supplier.entity';
import { AlternativeCustomer } from '../entities/alternative-customer.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalVoucher,
      JournalVoucherDetail,
      Account,
      CurrencyRate,
      Customer,
      Settings,
      Supplier,
      AlternativeCustomer,
    ]),
  ],
  controllers: [JournalVoucherController],
  providers: [JournalVoucherService],
})
export class JournalVoucherModule {}
