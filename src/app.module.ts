import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/entities/user.entity';
import { UserModule } from './user/user.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomerModule } from './customer/customer.module';
import { RequestModule } from './request/request.module';
import { SettingsService } from './settings/settings.service';
import { InvoiceService } from './invoice/invoice.service';

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
    InventoryModule,
    CustomerModule,
    RequestModule,
    RequestModule,
  ],
  providers: [SettingsService, InvoiceService],
})
export class AppModule {}
