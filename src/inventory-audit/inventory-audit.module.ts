import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryAuditController } from './inventory-audit.controller';
import { InventoryAuditService } from './inventory-audit.service';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ItemVariant, InventoryTransaction])],
  controllers: [InventoryAuditController],
  providers: [InventoryAuditService],
  exports: [InventoryAuditService],
})
export class InventoryAuditModule {}
