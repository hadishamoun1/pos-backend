import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Inventory } from '../entities/inventory.entity';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // Create a new inventory item
  @Post()
  create(@Body() data: Partial<Inventory>): Promise<Inventory> {
    return this.inventoryService.create(data);
  }

  // Retrieve all inventory items
  @Get()
  findAll(): Promise<Inventory[]> {
    return this.inventoryService.findAll();
  }

  // Retrieve a single inventory item by ID
  @Get(':id')
  findOne(@Param('id') id: number): Promise<Inventory> {
    return this.inventoryService.findOne(id);
  }

  // Update an inventory item by ID
  @Put(':id')
  update(@Param('id') id: number, @Body() data: Partial<Inventory>): Promise<Inventory> {
    return this.inventoryService.update(id, data);
  }

  // Delete an inventory item by ID
  @Delete(':id')
  delete(@Param('id') id: number): Promise<void> {
    return this.inventoryService.delete(id);
  }
}
