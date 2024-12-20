import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { ItemsService } from './items.service';
import { Item } from '../entities/inventory/item.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  // Create a new item
  @Post()
  async createItem(@Body() createItemDto: Partial<Item>): Promise<Item> {
    return this.itemsService.createItem(createItemDto);
  }

  // Get all items
  @Get()
  async getAllItems(): Promise<Item[]> {
    return this.itemsService.getAllItems();
  }

  // Get an item by ID
  @Get(':id')
  async getItemById(@Param('id') id: number): Promise<Item> {
    return this.itemsService.getItemById(id);
  }

  // Delete an item by ID
  @Delete(':id')
  async deleteItem(@Param('id') id: number): Promise<void> {
    return this.itemsService.deleteItem(id);
  }

  // Create a thickness for an item
  @Post(':itemId/thicknesses')
  async createThickness(
    @Param('itemId') itemId: number,
    @Body() createThicknessDto: Partial<Thickness>,
  ): Promise<Thickness> {
    createThicknessDto.item = { id: itemId } as Item;
    return this.itemsService.createThickness(createThicknessDto);
  }

  // Create a variant for a thickness
  @Post(':itemId/thicknesses/:thicknessId/variants')
  async createItemVariant(
    @Param('thicknessId') thicknessId: number,
    @Body() createItemVariantDto: Partial<ItemVariant>,
  ): Promise<ItemVariant> {
    createItemVariantDto.thickness = { id: thicknessId } as Thickness;
    return this.itemsService.createItemVariant(createItemVariantDto);
  }

  // Delete a thickness by ID
  @Delete('thicknesses/:id')
  async deleteThickness(@Param('id') id: number): Promise<void> {
    return this.itemsService.deleteThickness(id);
  }

  // Delete a variant by ID
  @Delete('variants/:id')
  async deleteItemVariant(@Param('id') id: number): Promise<void> {
    return this.itemsService.deleteItemVariant(id);
  }
  @Post('v1/full')
async createFullItem(@Body() createFullItemDto: any): Promise<Item> {
  return this.itemsService.createFullItem(createFullItemDto);
}

}
