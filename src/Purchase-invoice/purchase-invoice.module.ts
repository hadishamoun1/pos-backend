import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { PurchaseInvoiceDocument } from '../entities/Purchase-Invoice/purchase-invoice-document.entity';
import { SharedCharge } from '../entities/Purchase-Invoice/shared-charge.entity';
import { SharedChargeAllocation } from '../entities/Purchase-Invoice/shared-charge-allocation.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { BlExtractionService } from './bl-extraction.service';
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
import { ShipsgoModule } from '../shipsgo/shipsgo.module';
import { VesselTrackingModule } from '../vessel-tracking/vessel-tracking.module';


import { RecomputeModule } from '../recomputeTransfersAndPurchases/recompute.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ItemNameDescription,
      PurchaseInvoice,
      PurchaseInvoiceItem,
      PurchaseInvoiceDocument,
      SharedCharge,
      SharedChargeAllocation,
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
    ShipsgoModule,
    VesselTrackingModule,

    // ✅ module import (NOT inside forFeature)
    forwardRef(() => RecomputeModule),
  ],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService, BlExtractionService],
  exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}
