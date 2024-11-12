import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/entities/user.entity';
import { UserModule } from './user/user.module';

import { CustomerModule } from './customer/customer.module';
import { RequestModule } from './request/request.module';
import { SettingsService } from './settings/settings.service';
import { InvoiceService } from './invoice/invoice.service';
import { SettingsController } from './settings/settings.controller';
import { InvoiceController } from './invoice/invoice.controller';
import { SettingsModule } from './settings/settings.module';
import { InvoiceModule } from './invoice/invoice.module';
import { InventoryModule } from './inv/inv.module';

import { PurchaseInvoiceModule } from './purchases-invoice/purchases-invoice.module';
import { SupplierModule } from './suppliers/suppliers.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'localhost',          
      port: 3306,                  
      username: 'root', 
      password: '70631859HADI',
      database: 'pos_system_db',       
      autoLoadEntities: true,      
      synchronize: true,          
    }),
    //TypeOrmModule.forFeature([User]),
    UserModule,
    CustomerModule,
    RequestModule,
    SettingsModule,
    InvoiceModule,
    InventoryModule,
    PurchaseInvoiceModule,
    SupplierModule,
  ],
 
  
})
export class AppModule {}
