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
  
    @Get(':id')
    findOne(@Param('id') id: string) {
      return this.svc.findOne(+id);
    }
  
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateData: any) {
      return this.svc.update(+id, updateData);
    }
  
    @Delete(':id')
    remove(@Param('id') id: string) {
      return this.svc.remove(+id);
    }
  }
  