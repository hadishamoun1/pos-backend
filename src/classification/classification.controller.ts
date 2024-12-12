import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { Classification } from '../entities/classification.entity';

@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Get()
  async findAll(): Promise<Classification[]> {
    return this.classificationService.findAll();
  }

  @Get(':id')
  async findOneById(
    @Param('id') id: number,
  ): Promise<Classification | undefined> {
    return this.classificationService.findOneById(id);
  }

  @Get('code/:code')
  async findOneByCode(
    @Param('code') code: string,
  ): Promise<Classification | undefined> {
    return this.classificationService.findOneByCode(code);
  }

  @Post()
  async create(
    @Body() classification: Classification,
  ): Promise<Classification> {
    return this.classificationService.create(classification);
  }

  @Put(':id')
  async update(
    @Param('id') id: number,
    @Body() classification: Partial<Classification>,
  ): Promise<void> {
    await this.classificationService.update(id, classification);
  }

  @Delete(':id')
  async delete(@Param('id') id: number): Promise<void> {
    await this.classificationService.delete(id);
  }
}
