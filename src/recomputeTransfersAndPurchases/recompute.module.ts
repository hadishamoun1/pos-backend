import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RecomputeCostsController } from './recompute.controller';
import { RecomputeCostsService } from './recompute.service';

// Entities used by RecomputeCostsService
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';

// Modules that provide TransfersService + PurchaseInvoiceService
import { TransfersModule } from '../transfers/transfers.module';
import { PurchaseInvoiceModule } from '../Purchase-invoice/purchase-invoice.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryTransaction,
      ItemVariant,
      ItemNameDescription,
      ItemBatch,
      Transfer,
      TransferItem,
      PurchaseInvoice,
      PurchaseInvoiceItem,
    ]),

    // so DI can inject TransfersService + PurchaseInvoiceService
    forwardRef(() => TransfersModule),
    forwardRef(() => PurchaseInvoiceModule),
  ],
  controllers: [RecomputeCostsController],
  providers: [RecomputeCostsService],
  exports: [RecomputeCostsService],
})
export class RecomputeModule {}
