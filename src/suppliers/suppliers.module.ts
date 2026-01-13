import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from '../entities/supplier.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';
import { SupplierService } from './suppliers.service';
import { SupplierController } from './suppliers.controller';
import { AccountingModule } from 'src/accountRoleMap/accounting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, Account, Currency]),  AccountingModule,],
  controllers: [SupplierController],
  providers: [SupplierService],
  exports: [SupplierService], 
})
export class SupplierModule {}
