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


@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalVoucher,
      JournalVoucherDetail,
      Account,
      CurrencyRate,
      Customer,
      Settings,
      Supplier
    ]),
  ],
  controllers: [JournalVoucherController],
  providers: [JournalVoucherService],
})
export class JournalVoucherModule {}
