// src/transfers/transfers.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { Settings } from '../entities/settings.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransactionModule } from '../inventroy-transactions/inventroy-transactions.module';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { SqmPiece } from '../entities/inventory/SqmPiece.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { InventoryCount } from '../entities/inventory/count.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';

import { RecomputeModule } from '../recomputeTransfersAndPurchases/recompute.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transfer,
      TransferItem,
      Settings,
      InventoryTransaction,
      Thickness,
      ItemVariant,
      ItemBatch,
      SqmPiece,
      InvoiceItem,
      InventoryCount,
      PurchaseInvoiceItem,
      ItemNameDescription,
    ]),
    InventoryTransactionModule,

    forwardRef(() => RecomputeModule),
  ],
  providers: [TransfersService],
  controllers: [TransfersController],
  exports: [TransfersService],
})
export class TransfersModule {}
