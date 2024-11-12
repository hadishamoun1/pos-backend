// supplier.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { SupplierService } from './suppliers.service';
import { Supplier } from '../entities/suppliers.entity';

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  async findAll(): Promise<Supplier[]> {
    return await this.supplierService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: number): Promise<Supplier> {
    return await this.supplierService.findOne(id);
  }

  @Post()
  async create(@Body() supplierData: Partial<Supplier>): Promise<Supplier> {
    return await this.supplierService.create(supplierData);
  }

  @Put(':id')
  async update(
    @Param('id') id: number,
    @Body() supplierData: Partial<Supplier>,
  ): Promise<Supplier> {
    return await this.supplierService.update(id, supplierData);
  }

  @Delete(':id')
  async delete(@Param('id') id: number): Promise<void> {
    return await this.supplierService.delete(id);
  }
}
