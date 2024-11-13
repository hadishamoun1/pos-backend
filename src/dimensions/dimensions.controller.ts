// dimension.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { DimensionService } from './dimensions.service';
import { Dimension } from '../entities/inventory/dimension.entity';

@Controller('dimensions')
export class DimensionController {
  constructor(private readonly dimensionService: DimensionService) {}

  @Post()
  async create(
    @Body()
    createDimensionDto: {
      itemId: number;
      length: number;
      width: number;
      sheetsPerBox: number;
      origin: string;
    },
  ): Promise<Dimension> {
    // Call the service to create a new dimension and link it to an item
    return this.dimensionService.createDimension(createDimensionDto);
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
    @Body() updateDimensionDto: { quantityUnopenedBoxes?: number },
  ): Promise<Dimension> {
    return this.dimensionService.updateDimension(id, updateDimensionDto);
  }

  @Delete(':id')
  async delete(@Param('id') id: number): Promise<void> {
    return this.dimensionService.deleteDimension(id);
  }
}
