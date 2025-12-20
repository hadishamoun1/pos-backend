import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { UserModule } from './user/user.module';
import { CustomerModule } from './customer/customer.module';
import { SettingsModule } from './settings/settings.module';
import { ItemsModule } from './items/items.module';
import { CurrencyModule } from './currency/currency.module';
import { GroupModule } from './group/group.module';
import { ClassificationModule } from './classification/classification.module';
import { CategoriesModule } from './categories/categories.module';
import { BranchModule } from './branch/branch.module';
import { AccountsModule } from './accounts/accounts.module';
import { SupplierModule } from './suppliers/suppliers.module';
import { InvoiceModule } from './invoice/invoice.module';
import { PaymentVoucherModule } from './payment-voucher/payment-voucher.module';
import { JournalVoucherModule } from './journal-voucher/journal-voucher.module';
import { PurchaseVoucherModule } from './purchase-voucher/purchase-voucher.module';
import { CreditNoteModule } from './credit-note/credit-note.module';
import { DebitNoteModule } from './debit-note/debit-note.module';
import { ReceiptVoucherReturnModule } from './receipt-voucher-return/receipt-voucher-return.module';
import { PaymentVoucherReturnModule } from './payment-voucher-return/payment-voucher-return.module';
import { SalesReturnVoucherModule } from './sales-return-voucher/sales-return-voucher.module';
import { PurchaseReturnVoucherModule } from './purchase-return-voucher/purchase-return-voucher.module';
import { DebitNoteReturnModule } from './debit-note-returns/debit-note-returns.module';
import { CreditNoteReturnModule } from './credit-note-returns/credit-note-returns.module';
import { RequestModule } from './requests/requests.module';
import { InventoryTransactionModule } from './inventroy-transactions/inventroy-transactions.module';
import { PurchaseInvoiceSettingModule } from './Purchase-invoice-settings/purchase-invoice-settings.module';
import { PurchaseInvoiceModule } from './Purchase-invoice/purchase-invoice.module';
import { InventoryCountModule } from './count/count.module';
import { TransfersModule } from './transfers/transfers.module';
import { RecievablesModule } from './receipt-voucher/recievables.module';
import { ItemNameDescriptionModule } from './item-name-description/item-name-description.module';
import { ReportsModule } from './reports/reports.module';
import { SqmPiecesModule } from './sqmPiece/sqm-piece.module';
import { RecomputeModule } from './recomputeTransfersAndPurchases/recompute.module';
import { InventoryAuditModule } from './inventory-audit/inventory-audit.module';
import { AuthModule } from "./auth/auth.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'mysql',
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        username: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || '70631859HADI',
        database: process.env.DB_NAME || 'pos_v1',
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    UserModule,
    CustomerModule,
    SettingsModule,
    ItemsModule,
    CurrencyModule,
    GroupModule,
    ClassificationModule,
    CategoriesModule,
    BranchModule,
    AccountsModule,
    SupplierModule,
    InvoiceModule,
    PaymentVoucherModule,
    JournalVoucherModule,
    PurchaseVoucherModule,
    CreditNoteModule,
    DebitNoteModule,
    ReceiptVoucherReturnModule,
    PaymentVoucherReturnModule,
    SalesReturnVoucherModule,
    PurchaseReturnVoucherModule,
    DebitNoteReturnModule,
    CreditNoteReturnModule,
    RequestModule,
    InventoryTransactionModule,
    PurchaseInvoiceSettingModule,
    PurchaseInvoiceModule,
    InventoryCountModule,
    TransfersModule,
    RecievablesModule,
    ItemNameDescriptionModule,
    ReportsModule,
    SqmPiecesModule,
    RecomputeModule,
    InventoryAuditModule,
    AuthModule
  ],
})
export class AppModule {}
