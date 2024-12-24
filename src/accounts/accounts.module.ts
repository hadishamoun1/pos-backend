import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../entities/account.entity';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { Customer } from 'src/entities/customer.entity';
import { Supplier } from 'src/entities/supplier.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Customer, Supplier])],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
