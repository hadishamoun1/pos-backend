import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../entities/account.entity';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { Customer } from '../entities/customer.entity';
import { Supplier } from '../entities/supplier.entity';
import { AccountingModule } from '../accountRoleMap/accounting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Customer, Supplier]), AccountingModule,],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
