// src/inventory-count/inventory-count.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { InventoryCountService } from './count.service';

@Controller('inventory-count')
export class InventoryCountController {
  constructor(private readonly svc: InventoryCountService) {}

  @Post()
  create(@Body() createData: any | any[]) {
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
  @Get('v1/search')
  async search(
    @Query('q') q?: string,
    @Query('mode') mode: 'name' | 'real' = 'name',
    @Query('itemName') itemName?: string,
    @Query('type') type?: 'box' | 'sheet' | 'sqm' | 'unit',
    @Query('thickness') thickness?: string,
    @Query('length') length?: string,
    @Query('width') width?: string,
    @Query('sheetsPerBox') sheetsPerBox?: string,
    @Query('origin') origin?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.svc.searchVariants({
      q,
      mode,
      itemName,
      type,
      thickness: thickness != null ? Number(thickness) : undefined,
      length: length != null ? Number(length) : undefined,
      width: width != null ? Number(width) : undefined,
      sheetsPerBox: sheetsPerBox != null ? Number(sheetsPerBox) : undefined,
      origin,
      page: Number(page),
      limit: Number(limit),
    });
  }
  @Get('filtered-with-balance')
  async getFilteredCountsWithBalance() {
    return this.svc.getFilteredCountsWithBatchBalance();
  }

  @Post('v1/opening')
  @HttpCode(HttpStatus.CREATED)
  async createOpening(@Body() body: any) {
    const result = await this.svc.createSingleopening(body);
    return { message: 'Opening count created successfully', data: result };
  }

  @Post('v1/inventory-check')
  async createInventoryCheck(
    @Body()
    body: {
      itemBatchId: number;
      itemType: 'box' | 'sheet' | 'sqm';
      length: number;
      width: number;
      sheetsPerBox: number;
      records: {
        count: number;
        receivedDate: string;
        status: 'adj+' | 'adj-' | 'breakage';
      }[];
    },
  ): Promise<void> {
    const { itemBatchId, itemType, length, width, sheetsPerBox, records } =
      body;

    await this.svc.createInventoryCheck(
      itemBatchId,
      itemType,
      length,
      width,
      sheetsPerBox,
      records,
    );
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
