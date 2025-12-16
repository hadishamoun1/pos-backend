import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity.ts';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { Account } from '../entities/account.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { JournalVoucher } from 'src/entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from 'src/entities/Vouchers/journalVoucherDetails.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';
import { InvoiceItem } from 'src/entities/invoiceItem.entity';

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
      InvoiceItem

    ]),
  ],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService],
   exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}
