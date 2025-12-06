import { Controller, Get, Post, Body, Param, Delete, Query, ParseIntPipe, DefaultValuePipe, Put, BadRequestException, HttpCode, HttpStatus, Patch } from '@nestjs/common';
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
  @Post('v1/full/real')
  @HttpCode(HttpStatus.CREATED)
  async createFullByRealDescription(@Body() body: any): Promise<Item> {
    return this.itemsService.createFullItemUsingRealDescription(body);
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

@Get('v1/filtered-items-by-name')
getSelectedItemsByName(@Query('page') page?: string, @Query('limit') limit?: string) {
  return this.itemsService.getSelectedItemDetailsByNamePaginated({
    page: Number(page ?? 1),
    limit: Number(limit ?? 50),
  });
}




   // 1) Variant quick search for the picker
  @Get('variants/search')
  async searchVariants(
    @Query('q') q = '',
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    return this.itemsService.searchVariantsForRelinker(q, p, l);
  }

@Get('selected-details/by-description')
  async getSelectedItemDetailsByDescription(
    @Query('page') pageQ?: string,
    @Query('limit') limitQ?: string,
    @Query('includeEmpty') includeEmptyQ?: string,
  ) {
    // Parse + clamp numbers
    const pageNum = Number(pageQ ?? 1);
    const limitNum = Number(limitQ ?? 50);

    if (!Number.isFinite(pageNum) || !Number.isFinite(limitNum)) {
      throw new BadRequestException('Invalid pagination parameters.');
    }

    const page = Math.max(1, Math.trunc(pageNum));
    const limit = Math.min(200, Math.max(1, Math.trunc(limitNum)));

    // Parse boolean-ish strings
    const truthy = new Set(['1', 'true', 'yes', 'on']);
    const includeEmpty = truthy.has(String(includeEmptyQ ?? '').toLowerCase());

    return this.itemsService.getSelectedItemDetailsPaginatedByDescription({
      page,
      limit,
      includeEmpty,
    });
  }




@Get('v1/variant-ledger')
  getVariantLedger(@Query() q: any) {
    return this.itemsService.getVariantLedger({
      itemName: q.itemName,
      type: q.type,
      thickness: q.thickness ? Number(q.thickness) : undefined,
      length: q.length ? Number(q.length) : undefined,
      width: q.width ? Number(q.width) : undefined,
      sheetsPerBox: q.sheetsPerBox ? Number(q.sheetsPerBox) : undefined,
      origin: q.origin,
      page: q.page ? Number(q.page) : 1,
      limit: q.limit ? Number(q.limit) : 50,
    });
  }
  

@Get('v1/variant-ledger-by-name')
getVariantLedgerByItemName(@Query() q: any) {
  return this.itemsService.getVariantLedgerByItemNameDesc({
    itemName: q.itemName,
    type: q.type,
    thickness: q.thickness ? Number(q.thickness) : undefined,
    length: q.length ? Number(q.length) : undefined,
    width: q.width ? Number(q.width) : undefined,
    sheetsPerBox: q.sheetsPerBox ? Number(q.sheetsPerBox) : undefined,
    origin: q.origin,
    page: q.page ? Number(q.page) : 1,
    limit: q.limit ? Number(q.limit) : 50,
    // keep parity with the original:
    q: q.q,
    variantIds: Array.isArray(q.variantIds)
      ? q.variantIds.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
      : undefined,
  });
}


// items.controller.ts (or wherever your ItemsController is)

@Get('v1/real-variant-ledger')
async getVariantLedgerReal(
  @Query('q') q?: string,
  @Query('itemName') itemName?: string,
  @Query('type') type?: 'box' | 'sheet' | 'sqm' | 'unit',
  @Query('thickness') thickness?: string,
  @Query('length') length?: string,
  @Query('width') width?: string,
  @Query('sheetsPerBox') sheetsPerBox?: string,
  @Query('origin') origin?: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('variantIds') variantIdsRaw?: string, // "1,2,3"
  @Query('asOf') asOf?: string,                // ✅ NEW: "YYYY-MM-DD"
) {
  const variantIds = (variantIdsRaw || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0);

  return this.itemsService.getVariantLedgerByRealDesc({
    q,
    itemName,
    type,
    thickness: Number(thickness),
    length: Number(length),
    width: Number(width),
    sheetsPerBox: Number(sheetsPerBox),
    origin,
    page: Number(page),
    limit: Number(limit),
    variantIds: variantIds.length ? variantIds : undefined,
    asOf: asOf?.trim() || undefined, // ✅ pass through
  });
}




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



// using real description
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

// using item name description
// GET /items/v1/variant-search-by-name
@Get('v1/variant-search-by-name')
searchByName(@Query() params: any) {
  return this.itemsService.searchVariantsForModalPOSByNameDescription(params);
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


  
@Get('v1/stock-totals/all-variants-batches')
  async getStockTotalsAll(@Query() query: any) {
    return this.itemsService.getItemsStockTotals(query);
  }



    @Get('v1/stock-totals/variants')
  async getVariantStockAudit(@Query() q: any) {
    return this.itemsService.getVariantStockAudit(q);
  }


  
  @Get('v1/search-real')
  async searchReal(
    @Query('q') q = '',
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const p = Number(page) || 1;
    const l = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.itemsService.searchSmartReal(q ?? '', p, l);
  }


  // GET /items/item-descriptions/:descId/variants?limit=500&page=1&q=
  @Get('item-descriptions/:descId/variants')
  async listVariantsForDescription(
    @Param('descId') descId: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('q') q?: string, // optional extra filter on itemName/design/origin
  ) {
    const id = Number(descId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('descId must be a positive integer.');
    }
    const lim = Math.min(1000, Math.max(1, Number(limit ?? 500)));
    const pg  = Math.max(1, Number(page ?? 1));

    return this.itemsService.fetchDescriptionVariants({
      descId: id,
      limit: lim,
      page: pg,
      q: q && q.trim() ? q.trim() : undefined,
    });
  }



    // ---------- REAL DESCRIPTIONS ----------

  // GET /items/real-descriptions?q=...&withCounts=1|true|0|false
  @Get('real-descriptions')
  async listSortedReal(@Query() query: any) {
    const q = typeof query.q === 'string' ? query.q : undefined;
    let withCounts: boolean | undefined;
    if (query.withCounts !== undefined) {
      const s = String(query.withCounts).toLowerCase().trim();
      withCounts = s === '1' || s === 'true' || s === 'yes';
    }
    return this.itemsService.listSortedReal({
      q,
      withCounts: withCounts ?? false,
    });
  }

  // 3) Optional description search for autocomplete
  @Get('descriptions/search')
  async searchDescriptions(
    @Query('mode') mode: 'real' | 'name' = 'name',
    @Query('q') q = '',
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    return this.itemsService.searchDescriptions(mode, q, p, l);
  }


  // GET /items/real-descriptions/:realDescId/variants?limit=500&page=1&q=
  @Get('real-descriptions/:realDescId/variants')
  async listVariantsForRealDescription(
    @Param('realDescId') realDescId: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('q') q?: string, // optional extra filter on itemName/origin
  ) {
    const id = Number(realDescId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('realDescId must be a positive integer.');
    }
    const lim = Math.min(1000, Math.max(1, Number(limit ?? 500)));
    const pg  = Math.max(1, Number(page ?? 1));

    return this.itemsService.fetchRealDescriptionVariants({
      realDescId: id,
      limit: lim,
      page: pg,
      q: q && q.trim() ? q.trim() : undefined,
    });
  }


  // GET /item-descriptions?q=...&withCounts=true|1|false|0
  @Get('item-descriptions')
  async listSorted(@Query() query: any) {
    const q = typeof query.q === 'string' ? query.q : undefined;

    // accept 1/0/true/false/yes/no (case-insensitive)
    let withCounts: boolean | undefined;
    if (query.withCounts !== undefined) {
      const s = String(query.withCounts).toLowerCase().trim();
      withCounts = s === '1' || s === 'true' || s === 'yes';
    }

    return this.itemsService.listSorted({
      q,
      withCounts: withCounts ?? false,
    });
  }

  // PUT /item-descriptions/reorder  body: { order: number[] }
  @Put('item-descriptions/reorder')
  async reorder(@Body() body: any) {
    if (!body || !Array.isArray(body.order) || body.order.length === 0) {
      throw new BadRequestException('Body must be { order: number[] } with at least one id.');
    }
    // quick sanity: coerce to numbers and ensure positives
    const order = body.order.map((x: any) => Number(x));
    const invalid = order.filter((n: number) => !Number.isInteger(n) || n < 1);
    if (invalid.length) {
      throw new BadRequestException(
        `Order must be an array of positive integer IDs. Invalid: [${invalid.join(', ')}]`
      );
    }

    await this.itemsService.reorder(order);
    return { ok: true };
  }

    // PUT /items/real-descriptions/reorder  body: { order: number[] }
  @Put('real-descriptions/reorder')
  async reorderReal(@Body() body: any) {
    if (!body || !Array.isArray(body.order) || body.order.length === 0) {
      throw new BadRequestException('Body must be { order: number[] } with at least one id.');
    }
    const order = body.order.map((x: any) => Number(x));
    const invalid = order.filter((n: number) => !Number.isInteger(n) || n < 1);
    if (invalid.length) {
      throw new BadRequestException(
        `Order must be an array of positive integer IDs. Invalid: [${invalid.join(', ')}]`
      );
    }
    await this.itemsService.reorderReal(order);
    return { ok: true };
  }

@Put('variants/:variantId/description')
async relinkVariantDescription(
  @Param('variantId', ParseIntPipe) variantId: number,
  @Body() dto: {
    mode: 'real' | 'name';
    description?: { id?: number } | null; // null means unlink
    fields?: {
      itemNumber?: string;
      categoryName?: string;
      subCategory?: string;
      colorName?: string;
      designName?: string;
    } | null;
    alsoSetOtherSide?: boolean;
  },
) {
  if (!dto || (dto.mode !== 'real' && dto.mode !== 'name')) {
    throw new BadRequestException('mode must be "real" or "name"');
  }

  // valid if:
  // - description.id present  (link existing)
  // - fields present          (create/link by values)
  // - description === null    (unlink)
  const hasId = !!dto.description?.id;
  const hasFields =
    dto.fields &&
    (dto.fields.itemNumber ||
      dto.fields.categoryName ||
      dto.fields.subCategory ||
      dto.fields.colorName ||
      dto.fields.designName);

  const isUnlink = dto.hasOwnProperty('description') && dto.description === null && !dto.fields;

  if (!hasId && !hasFields && !isUnlink) {
    throw new BadRequestException(
      'Provide either "description.id", or "fields", or set "description": null (to unlink).'
    );
  }

  return this.itemsService.relinkVariantDescription(variantId, dto);
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


    @Put('v1/stock-totals/variants/:id/totals')
  async updateVariantTotals(@Param('id') id: string, @Body() body: any) {
    return this.itemsService.updateVariantTotals(Number(id), body);
  }

  // ✅ Edit BATCH totals (start/in/out + OFR). Balances recalculated, then variant totals rebuilt from batches.
  // PUT /items/v1/stock-totals/batches/:id/totals
  @Put('v1/stock-totals/batches/:id/totals')
  async updateBatchTotals(@Param('id') id: string, @Body() body: any) {
    return this.itemsService.updateBatchTotals(Number(id), body);
  }


  // Edit Item-Name description (NO DTO)
  @Patch('descriptions/name/:id')
  async updateItemNameDescriptionRaw(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.itemsService.updateItemNameDescriptionRaw(id, body);
  }

  // Edit Real description (NO DTO)
  @Patch('descriptions/real/:id')
  async updateRealDescriptionRaw(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.itemsService.updateRealDescriptionRaw(id, body);
  }


  @Delete(':id')
  async deleteItem(@Param('id', ParseIntPipe) id: number) {
    return this.itemsService.deleteItemAndDescriptions(id);
  }


}
