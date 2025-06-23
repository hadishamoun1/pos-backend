import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';
import { Item } from '../entities/inventory/item.entity';
import { ItemNameDescriptionService } from './item-name-description.service';
import { ItemNameDescriptionController } from './item-name-description.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ItemNameDescription, Item])],
  providers: [ItemNameDescriptionService],
  controllers: [ItemNameDescriptionController],
})
export class ItemNameDescriptionModule {}
