import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

import { Account } from '../entities/account.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { AccountRoleMap } from "../entities/accountRoleMap.entity";
import { Customer } from '../entities/customer.entity';
import { Supplier } from '../entities/supplier.entity';

import { AccountsModule } from '../accounts/accounts.module';
import { CompanyModule } from '../company/company.module'; // ← ADD THIS

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, JournalVoucher, JournalVoucherDetail, AccountRoleMap, Supplier, Customer]),
    AccountsModule,
    CompanyModule, // ← ADD THIS
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}