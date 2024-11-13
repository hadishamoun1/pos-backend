import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './user/user.module';
import { CustomerModule } from './customer/customer.module';
import { RequestModule } from './request/request.module';
import { SettingsModule } from './settings/settings.module';
import { InvoiceModule } from './invoice/invoice.module';
import { InventoryModule } from './inv/inv.module';
import { PurchaseInvoiceModule } from './purchases-invoice/purchases-invoice.module';
import { SupplierModule } from './suppliers/suppliers.module';
import { ItemsModule } from './items/items.module';

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
    ItemsModule,
  ],
 
  
})
export class AppModule {}
