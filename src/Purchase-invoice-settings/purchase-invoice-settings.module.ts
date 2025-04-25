import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceSetting } from '../entities/purchaseInvoiceSettings';
import { PurchaseInvoiceSettingService } from './purchase-invoice-settings.service';
import { PurchaseInvoiceSettingController } from './purchase-invoice-settings.controller';
import { Account } from '../entities/account.entity';
import { Customer } from '../entities/customer.entity';
import { Supplier } from '../entities/supplier.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseInvoiceSetting,
      Account,
      Customer,
      Supplier,
    ]),
  ],
  providers: [PurchaseInvoiceSettingService],
  controllers: [PurchaseInvoiceSettingController],
})
export class PurchaseInvoiceSettingModule {}
