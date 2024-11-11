// purchaseInvoice.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceService } from './purchases-invoice.service';
import { PurchaseInvoiceController } from './purchases-invoice.controller';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';
import { PurchaseItem } from '../entities/purchaseItem.entity';
import { Dimension } from '../entities/inventory/dimension.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseInvoice, PurchaseItem, Dimension]),
  ],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService],
  exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}
