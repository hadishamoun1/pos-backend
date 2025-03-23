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
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity'; // Import SalesVoucher entity
import { SalesVoucherDetail } from '../entities/Vouchers/salesVoucherDetails.entity'; // Import SalesVoucherDetail entity

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
      SalesVoucher, // Add SalesVoucher entity
      SalesVoucherDetail, // Add SalesVoucherDetail entity
    ]),
  ],
  providers: [InvoiceService, InventoryTransaction, InvoiceGateway],
  controllers: [InvoiceController],
  exports: [InvoiceService],
})
export class InvoiceModule {}
