import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from '../entities/supplier.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, Account, Currency])],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService], // Export if needed by other modules
})
export class SupplierModule {}
