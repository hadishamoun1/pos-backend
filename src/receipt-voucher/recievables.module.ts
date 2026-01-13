// src/receipt-voucher/recievables.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecievablesService } from './recievables.service';
import { RecievablesController } from './recievables.controller';
import { ReceiptEntry } from '../entities/recievables.entities';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Customer } from '../entities/customer.entity';
import { Account } from '../entities/account.entity';
import { Settings } from '../entities/settings.entity';
import { RecievablesGateway } from './recievables.broadcast';
import { Currency } from 'src/entities/currency.entity';
import { Invoice } from '../entities/invoice.entity';
import { AccountingModule } from 'src/accountRoleMap/accounting.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReceiptEntry,
      JournalVoucher,
      JournalVoucherDetail,
      Customer,
      Account,
      Settings,
      Currency,
      Invoice
    ]),
     AccountingModule,
  ],
  controllers: [RecievablesController],
  providers: [RecievablesService, RecievablesGateway],
  exports: [RecievablesService],
})
export class RecievablesModule {}
