import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { SupplierService } from './suppliers.service';
import { Supplier } from '../entities/supplier.entity';

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  createSupplier(@Body() supplierData: Partial<Supplier>): Promise<Supplier> {
    return this.supplierService.createSupplier(supplierData);
  }

  @Get()
  getAllSuppliers(): Promise<Supplier[]> {
    return this.supplierService.getAllSuppliers();
  }

  @Get(':id')
  getSupplierById(@Param('id') id: number): Promise<Supplier> {
    return this.supplierService.getSupplierById(id);
  }

  @Delete(':id')
  deleteSupplier(@Param('id') id: number): Promise<void> {
    return this.supplierService.deleteSupplier(id);
  }
}
