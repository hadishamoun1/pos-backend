// dimension.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { DimensionService } from './dimensions.service';
import { Dimension } from '../entities/inventory/dimension.entity';

@Controller('dimensions')
export class DimensionController {
  constructor(private readonly dimensionService: DimensionService) {}

  @Post()
  async create(@Body() data: Partial<Dimension>): Promise<Dimension> {
    return this.dimensionService.createDimension(data);
  }

  @Get()
  async findAll(): Promise<Dimension[]> {
    return this.dimensionService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: number): Promise<Dimension> {
    return this.dimensionService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: number,
    @Body() data: Partial<Dimension>,
  ): Promise<Dimension> {
    return this.dimensionService.updateDimension(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: number): Promise<void> {
    return this.dimensionService.deleteDimension(id);
  }
}
