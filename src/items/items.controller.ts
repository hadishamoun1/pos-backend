import { Controller, Get, Post, Body, Param, Delete, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ItemsService } from './items.service';
import { Item } from '../entities/inventory/item.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  // ----- Specific routes first -----

  @Post()
  async createItem(@Body() createItemDto: Partial<Item>): Promise<Item> {
    return this.itemsService.createItem(createItemDto);
  }

  @Post('v1/full')
  async createFullItem(@Body() createFullItemDto: any): Promise<Item> {
    return this.itemsService.createFullItem(createFullItemDto);
  }

  @Post('v1/create-complete-item')
  async createCompleteItem(@Body() createFullItemDto: any): Promise<Item> {
    return this.itemsService.createFullItem(createFullItemDto);
  }

  @Get('v1/all')
  async getAllItems(): Promise<Item[]> {
    return this.itemsService.getAllItemsWithDetails();
  }

@Get('v1/filtered-items')
async getSelectedPaginated(
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('includeEmpty') includeEmpty?: string,
) {
  const p = Number(page ?? 1);
  const l = Number(limit ?? 50);
  const ie = includeEmpty === '1' || includeEmpty === 'true';
  return this.itemsService.getSelectedItemDetailsPaginated({
    page: p,
    limit: l,
    includeEmpty: ie,
  });
}
// items.controller.ts

  @Get('v2/filtered-items')
  async getItemColumns(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    // clamp
    const pageNum = Math.max(1, page || 1);
    const limitNum = Math.min(500, Math.max(1, limit || 100));
    return this.itemsService.getitemDetails({ page: pageNum, limit: limitNum });
  }
  // 🔎 Search modal endpoint (must be above :id)
  @Get('pos/search-modal')
  async searchForModal(
    @Query('q') q?: string,
    @Query('dims') dims?: string,
    @Query('length') length?: string,
    @Query('width') width?: string,
    @Query('spb') spb?: string,
    @Query('type') type?: 'box' | 'sheet' | 'sqm' | 'unit',
    @Query('page') page = '1',
    @Query('limit') limit = '100',
  ) {
    const lengthNum = length ? Number(length) : undefined;
    const widthNum  = width  ? Number(width)  : undefined;
    const spbNum    = spb    ? Number(spb)    : undefined;

    return this.itemsService.searchForModalPOS({
      q: q ?? '',
      dims: dims ?? '',
      length: lengthNum,
      width: widthNum,
      spb: spbNum,
      type,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(500, Math.max(1, Number(limit) || 100)),
    });
  }

  @Post(':itemId/thicknesses')
  async createThickness(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() createThicknessDto: Partial<Thickness>,
  ): Promise<Thickness> {
    createThicknessDto.item = { id: itemId } as Item;
    return this.itemsService.createThickness(createThicknessDto);
  }

  @Post(':itemId/thicknesses/:thicknessId/variants')
  async createItemVariant(
    @Param('thicknessId', ParseIntPipe) thicknessId: number,
    @Body() createItemVariantDto: Partial<ItemVariant>,
  ): Promise<ItemVariant> {
    createItemVariantDto.thickness = { id: thicknessId } as Thickness;
    return this.itemsService.createItemVariant(createItemVariantDto);
  }

  @Delete('thicknesses/:id')
  async deleteThickness(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.itemsService.deleteThickness(id);
  }

  @Delete('variants/:id')
  async deleteItemVariant(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.itemsService.deleteItemVariant(id);
  }

  // ----- Put the catch-alls LAST -----

  @Get(':id')
  async getItemById(@Param('id', ParseIntPipe) id: number): Promise<Item> {
    return this.itemsService.getItemById(id);
  }

  @Delete(':id')
  async deleteItem(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.itemsService.deleteItem(id);
  }
}
