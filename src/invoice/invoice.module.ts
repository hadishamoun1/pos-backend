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
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      Customer,
      Branch,
      Currency,
      InvoiceItem,
      InventoryTransaction,
    ]),
  ],
  providers: [InvoiceService],
  controllers: [InvoiceController],
})
export class InvoiceModule {}
