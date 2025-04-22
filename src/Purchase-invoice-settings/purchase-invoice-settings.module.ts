import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceSetting } from '../entities/purchaseInvoiceSettings';
import { PurchaseInvoiceSettingService } from './purchase-invoice-settings.service';
import { PurchaseInvoiceSettingController } from './purchase-invoice-settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PurchaseInvoiceSetting])],
  providers: [PurchaseInvoiceSettingService],
  controllers: [PurchaseInvoiceSettingController],
})
export class PurchaseInvoiceSettingModule {}
