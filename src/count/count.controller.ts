// src/inventory-count/inventory-count.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { InventoryCountService } from './count.service';

@Controller('inventory-count')
export class InventoryCountController {
  constructor(private readonly svc: InventoryCountService) {}

  @Post()
  create(@Body() createData: any) {
    return this.svc.create(createData);
  }

  @Get()
  findAll() {
    return this.svc.findAll();
  }
  @Get('v1/filtered')
  getFilteredCounts() {
    return this.svc.getFilteredCounts();
  }

  /** Update an existing count (and its linked transaction) */
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateData: any) {
    return this.svc.update(+id, updateData);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(+id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(+id);
  }
}
