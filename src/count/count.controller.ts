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
