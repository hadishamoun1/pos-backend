import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { SupplierProformaService } from './supplier-proforma.service';
import { SupplierProforma } from '../entities/supplierProforma.entity';

@Controller('supplier-proformas')
export class SupplierProformaController {
  constructor(
    private readonly supplierProformaService: SupplierProformaService,
  ) {}

  @Post()
  create(
    @Body() proformaData: Partial<SupplierProforma>,
  ): Promise<SupplierProforma> {
    return this.supplierProformaService.create(proformaData);
  }

  @Get()
  findAll(): Promise<SupplierProforma[]> {
    return this.supplierProformaService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<SupplierProforma> {
    return this.supplierProformaService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateData: Partial<SupplierProforma>,
  ): Promise<SupplierProforma> {
    return this.supplierProformaService.update(id, updateData);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.supplierProformaService.remove(id);
  }
}
