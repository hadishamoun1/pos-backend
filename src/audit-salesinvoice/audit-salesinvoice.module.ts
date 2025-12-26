import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditService } from './audit-saleinvoice.service';
import { AuditController } from './audit-salesinvoice.controller';

import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity'; // ✅ correct import
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceItem,
      JournalVoucher,
      JournalVoucherDetail,
      InventoryTransaction,
      ItemVariant,
      ItemBatch,
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditSaleInvoiceModule {}
