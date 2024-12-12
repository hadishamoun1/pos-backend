import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Categories } from '../entities/categories.entity';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async findAll(): Promise<Categories[]> {
    return this.categoriesService.findAll();
  }

  @Get(':id')
  async findOneById(@Param('id') id: number): Promise<Categories | undefined> {
    return this.categoriesService.findOneById(id);
  }

  @Get('code/:code')
  async findOneByCode(@Param('code') code: string): Promise<Categories | undefined> {
    return this.categoriesService.findOneByCode(code);
  }

  @Post()
  async create(@Body() categories: Categories): Promise<Categories> {
    return this.categoriesService.create(categories);
  }

  @Put(':id')
  async update(@Param('id') id: number, @Body() categories: Partial<Categories>): Promise<void> {
    await this.categoriesService.update(id, categories);
  }

  @Delete(':id')
  async delete(@Param('id') id: number): Promise<void> {
    await this.categoriesService.delete(id);
  }
}