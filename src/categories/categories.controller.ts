import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Categories } from '../entities/categories.entity';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':categoriesCode')
  findOne(@Param('categoriesCode') categoriesCode: string) {
    return this.categoriesService.findOne(categoriesCode);
  }

  @Post()
  create(@Body() categories: Categories) {
    return this.categoriesService.create(categories);
  }

  @Put(':categoriesCode')
  update(
    @Param('categoriesCode') categoriesCode: string,
    @Body() categories: Partial<Categories>,
  ) {
    return this.categoriesService.update(categoriesCode, categories);
  }

  @Delete(':categoriesCode')
  delete(@Param('categoriesCode') categoriesCode: string) {
    return this.categoriesService.delete(categoriesCode);
  }
}
