import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { SupplierProformaService } from './supplier-proforma.service';
import { SupplierProforma } from '../entities/supplierProforma.entity';

@Controller('supplier-proformas')
export class SupplierProformaController {
  constructor(private readonly supplierProformaService: SupplierProformaService) {}

  @Post()
  create(@Body() supplierProformaData: Partial<SupplierProforma>) {
    return this.supplierProformaService.create(supplierProformaData);
  }

  @Get()
  findAll() {
    return this.supplierProformaService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.supplierProformaService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() updateData: Partial<SupplierProforma>) {
    return this.supplierProformaService.update(id, updateData);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.supplierProformaService.remove(id);
  }
}
