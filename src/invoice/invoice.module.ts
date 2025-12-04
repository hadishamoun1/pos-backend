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
import { PurchaseInvoiceItem } from 'src/entities/Purchase-Invoice/purchase-invoice-item.entity';
import { InventoryCount } from 'src/entities/inventory/count.entity';
import { SqmPiece } from 'src/entities/inventory/SqmPiece.entity';
import { Request as RequestEntity } from '../entities/request.entity';
import { RequestDetail as RequestDetailEntity } from '../entities/requestDetails.entity';

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
        PurchaseInvoiceItem,  
      InventoryCount,
      SqmPiece,
      RequestEntity,
      RequestDetailEntity 
    ]),
  ],
  providers: [InvoiceService, InventoryTransaction, InvoiceGateway],
  controllers: [InvoiceController],
  exports: [InvoiceService],
})
export class InvoiceModule {}
