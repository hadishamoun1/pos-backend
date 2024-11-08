import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dimension } from '../entities/inventory/dimension.entity';
import { AdjustedBox } from '../entities/inventory/adjustedBox.entity';
import { OpenedSheet } from '../entities/inventory/openedSheet.entity';
import { InventoryTracking } from '../entities/inventory/inventoryTracking.entity';
import { InventoryService } from './inv.service';
import { InventoryController } from './inv.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dimension, AdjustedBox, OpenedSheet, InventoryTracking]),
  ],
  providers: [InventoryService],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
