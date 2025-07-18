import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { InventoryTransactionService } from './inventroy-transactions.service';
import { InventoryTransactionController } from './inventroy-transactions.controller';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransactionGateway } from './inventory-transaction.gateway';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { Item } from 'src/entities/inventory/item.entity';
import { Thickness } from 'src/entities/inventory/thickness.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryTransaction,
      ItemVariant,
      ItemBatch,
      Item,
      Thickness,
    ]),
  ],
  controllers: [InventoryTransactionController],
  providers: [InventoryTransactionService, InventoryTransactionGateway],
  exports: [InventoryTransactionService, InventoryTransactionGateway],
})
export class InventoryTransactionModule {}
