import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';
import { Item } from '../entities/inventory/item.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Item, Thickness, ItemVariant, ItemBatch,ItemNameDescription]),
  ],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
