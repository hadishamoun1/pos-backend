// src/inventory-count/inventory-count.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryCountService } from './count.service';
import { InventoryCountController } from './count.controller';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryCount,
      ItemVariant,
      InventoryTransaction,
    ]),
  ],
  providers: [InventoryCountService],
  controllers: [InventoryCountController],
})
export class InventoryCountModule {}
