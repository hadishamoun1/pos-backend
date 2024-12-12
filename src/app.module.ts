import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './user/user.module';
import { CustomerModule } from './customer/customer.module';
import { SettingsModule } from './settings/settings.module';
import { InvoiceModule } from './invoice/invoice.module';

import { ItemsModule } from './items/items.module';
import { CurrencyModule } from './currency/currency.module';
import { GroupModule } from './group/group.module';
import { ClassificationModule } from './classification/classification.module';
import { CategoriesModule } from './categories/categories.module';
import { BranchModule } from './branch/branch.module';
import { AccountsModule } from './accounts/accounts.module';

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

    SettingsModule,
    InvoiceModule,
   
    ItemsModule,
    CurrencyModule,
    GroupModule,
    ClassificationModule,
    CategoriesModule,
    BranchModule,
    AccountsModule,
  ],
  
})
export class AppModule {}
