import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from '../entities/suppliers.entity';
import { SupplierService } from './suppliers.service';
import { SupplierController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier])],
  providers: [SupplierService, SuppliersService],
  controllers: [SupplierController],
  exports: [SupplierService],
})
export class SupplierModule {}
