// purchaseInvoice.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceService } from './purchases-invoice.service';
import { PurchaseInvoiceController } from './purchases-invoice.controller';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';
import { PurchaseInvoiceItem } from '../entities/purchaseItem.entity';
import { Dimension } from '../entities/inventory/dimension.entity';
import { Supplier } from '../entities/suppliers.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseInvoice, PurchaseInvoiceItem, Dimension, Supplier]),
  ],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService],
  exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}
