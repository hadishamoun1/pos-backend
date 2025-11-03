import { Controller, Get, Post, Body, Param, Delete, Query, ParseIntPipe, DefaultValuePipe, Put } from '@nestjs/common';
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
    const limitNum = Math.min(500, Math.max(1, limit || 200));
    return this.itemsService.getitemDetails({ page: pageNum, limit: limitNum });
  }




 @Get('v1/variant-search')
  async variantSearch(
    @Query('q') q?: string,
    @Query('dims') dims?: string,
    @Query('length') length?: string,
    @Query('width') width?: string,
    @Query('spb') spb?: string,
    @Query('type') type?: 'box'|'sheet'|'sqm'|'unit',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.itemsService.searchVariantsForModalPOS({
      q,
      dims,
      length: length != null ? Number(length) : undefined,
      width:  width  != null ? Number(width)  : undefined,
      spb:    spb    != null ? Number(spb)    : undefined,
      type,
      page: Number(page ?? 1),
      limit: Number(limit ?? 100),
    });
  }




  @Get('v2/filtered-items-all-batches')
  async getFilteredItemsAllBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Number.isFinite(Number(page)) && Number(page) ? Number(page) : 1;
    const l = Number.isFinite(Number(limit)) && Number(limit) ? Number(limit) : 100;

    return this.itemsService.getitemDetailsAllBatches({ page: p, limit: l });
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

  // Add a new route for the in-stock search
@Get('pos/search-modal-instock')
async searchModalInStock(
  @Query('q') q: string,
  @Query('dims') dims?: string,
  @Query('length') length?: string,
  @Query('width') width?: string,
  @Query('spb') spb?: string,
  @Query('type') type?: 'box' | 'sheet' | 'sqm' | 'unit',
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('roundUnitsToInt') roundUnitsToInt?: string,
) {
  const p = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const l = Number.isFinite(Number(limit)) ? Math.min(500, Math.max(1, Number(limit))) : 50;

  return this.itemsService.searchForModalPOSInStock({
    q: q ?? '',
    dims,
    length: Number.isFinite(Number(length)) ? Number(length) : undefined,
    width:  Number.isFinite(Number(width))  ? Number(width)  : undefined,
    spb:    Number.isFinite(Number(spb))    ? Number(spb)    : undefined,
    type,
    page: p,
    limit: l,
    roundUnitsToInt: ['1', 'true', 'yes'].includes(String(roundUnitsToInt || '').toLowerCase()),
  });
}

 @Get('v1/search')
  async searchItems(
    @Query('q') q: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    data: Array<{
      itemId: number;
      itemName: string;
      type: 'box' | 'sheet' | 'sqm';
      thicknessId: number;
      thickness: number;
      variantId: number;
      length: number;
      width: number;
      sheetsPerBox: number;
      origin: string | null;
      description?: {
        id: number | null;
        itemNumber: string | null;
        categoryName: string | null;
        subCategory: string | null;
        colorName: string | null;
        designName: string | null;
      };
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const pg = Math.max(1, Number(page) || 1);
    const lm = Math.max(1, Math.min(200, Number(limit) || 50));
    return this.itemsService.searchSmart(q || '', pg, lm);
  }

  


  @Post(':itemId/thicknesses')
  async createThickness(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() createThicknessDto: Partial<Thickness>,
  ): Promise<Thickness> {
    createThicknessDto.item = { id: itemId } as Item;
    return this.itemsService.createThickness(createThicknessDto);
  }
  


  @Post('batches/seed-clean')
  async seedCleanBatches(@Body() body: {
    variantIds?: number[];
    itemId?: number;
    all?: boolean;
    force?: boolean;
  }) {
    const { variantIds, itemId, all, force } = body || {};

    if (Array.isArray(variantIds) && variantIds.length > 0) {
      return this.itemsService.createCleanBatchesForVariants(variantIds, { force });
    }
    if (typeof itemId === 'number') {
      return this.itemsService.createCleanBatchesForItem(itemId, { force });
    }
    if (all) {
      return this.itemsService.createCleanBatchesForAll({ force });
    }

    // If the client passes a single variantId as number
    if (typeof (body as any)?.variantId === 'number') {
      const r = await this.itemsService.createCleanBatchForVariant((body as any).variantId, { force });
      return { created: r.created ? 1 : 0, skipped: r.created ? 0 : 1, results: [r] };
    }

    throw new Error('Provide one of: { variantIds: number[] } | { itemId: number } | { all: true } | { variantId: number }');
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

  @Put('v1/full')
  async editFullItem(@Body() editFullItemDto: any): Promise<Item> {
    return this.itemsService.editFullItem(editFullItemDto);
  }

  @Delete(':id')
  async deleteItem(@Param('id', ParseIntPipe) id: number) {
    return this.itemsService.deleteItemAndDescriptions(id);
  }


}
