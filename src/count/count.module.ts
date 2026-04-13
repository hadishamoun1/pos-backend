// src/inventory-count/inventory-count.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryCountService } from './count.service';
import { InventoryCountController } from './count.controller';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryCount,
      ItemVariant,
      InventoryTransaction,
      ItemBatch,
      ItemNameDescription,
      PurchaseInvoiceItem
    ]),
  ],
  providers: [InventoryCountService],
  controllers: [InventoryCountController],
})
export class InventoryCountModule {}
