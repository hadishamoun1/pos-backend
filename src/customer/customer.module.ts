import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../entities/customer.entity';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { AccountingModule } from '../accountRoleMap/accounting.module';


@Module({
  imports: [TypeOrmModule.forFeature([Customer, Account, Currency,JournalVoucherDetail]),
AccountingModule, 
],
  
  providers: [CustomerService],
  controllers: [CustomerController],
})
export class CustomerModule {}
