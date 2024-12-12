import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../entities/customer.entity';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, Account, Currency])],
  providers: [CustomerService],
  controllers: [CustomerController],
})
export class CustomerModule {}
