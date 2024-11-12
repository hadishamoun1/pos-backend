import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from '../entities/suppliers.entity';
import { SupplierService } from './suppliers.service';
import { SupplierController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier])],
  providers: [SupplierService, SuppliersService],
  controllers: [SupplierController, SuppliersController],
  exports: [SupplierService],
})
export class SupplierModule {}
