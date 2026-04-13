import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { Account } from '../entities/account.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { Settings } from '../entities/settings.entity';
import { AccountingModule } from '../accountRoleMap/accounting.module';


import { RecomputeModule } from '../recomputeTransfersAndPurchases/recompute.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ItemNameDescription,
      PurchaseInvoice,
      PurchaseInvoiceItem,
      UnitPriceModalRow,
      InventoryTransaction,
      PurchaseVoucher,
      Account,
      ItemVariant,
      JournalVoucher,
      JournalVoucherDetail,
      ItemBatch,
      InvoiceItem,
      Settings,
     
    ]),
     AccountingModule, 

    // ✅ module import (NOT inside forFeature)
    forwardRef(() => RecomputeModule),
  ],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService],
  exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}
