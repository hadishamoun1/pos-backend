import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Put,
  Delete,
} from '@nestjs/common';
import { ItemNameDescriptionService } from './item-name-description.service';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';

@Controller('item-name-descriptions')
export class ItemNameDescriptionController {
  constructor(private readonly descService: ItemNameDescriptionService) {}

  @Post()
  create(@Body() data: Partial<ItemNameDescription>) {
    return this.descService.create(data);
  }

  @Get()
  findAll() {
    return this.descService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.descService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: number, @Body() data: Partial<ItemNameDescription>) {
    return this.descService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.descService.remove(id);
  }
}
