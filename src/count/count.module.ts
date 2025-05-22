// src/inventory-count/inventory-count.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryCountService } from './count.service';
import { InventoryCountController } from './count.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryCount, ItemVariant])],
  providers: [InventoryCountService],
  controllers: [InventoryCountController],
})
export class InventoryCountModule {}
