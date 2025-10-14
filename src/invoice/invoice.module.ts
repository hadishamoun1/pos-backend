import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { Branch } from '../entities/branch.entity';
import { Currency } from '../entities/currency.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InvoiceGateway } from './invoice.gateway';
import { Settings } from '../entities/settings.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity'; 
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      Customer,
      Branch,
      Currency,
      InvoiceItem,
      InventoryTransaction,
      ItemVariant,
      Settings,
      ItemBatch,
      JournalVoucher,
      JournalVoucherDetail,
      Account, 
    ]),
  ],
  providers: [InvoiceService, InventoryTransaction, InvoiceGateway],
  controllers: [InvoiceController],
  exports: [InvoiceService],
})
export class InvoiceModule {}
