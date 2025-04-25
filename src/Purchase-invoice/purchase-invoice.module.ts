import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity.ts';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoiceController } from './purchase-invoice.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseInvoice,
      PurchaseInvoiceItem,
      UnitPriceModalRow,
    ]),
  ],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}
