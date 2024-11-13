// item.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from '../entities/inventory/item.entity';
import { ItemService } from './items.service';
import { ItemController } from './items.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Item])],
  providers: [ItemService],
  controllers: [ItemController],
  exports: [TypeOrmModule, ItemService], 
})
export class ItemModule {}
