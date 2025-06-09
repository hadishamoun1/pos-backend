import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { InventoryTransactionService } from './inventroy-transactions.service';
import { InventoryTransactionController } from './inventroy-transactions.controller';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransactionGateway } from './inventory-transaction.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryTransaction, ItemVariant])],
  controllers: [InventoryTransactionController],
  providers: [InventoryTransactionService, InventoryTransactionGateway],
  exports: [InventoryTransactionService, InventoryTransactionGateway], // Export so other modules can use it
})
export class InventoryTransactionModule {}
