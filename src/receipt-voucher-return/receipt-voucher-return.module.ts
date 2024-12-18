import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReceiptVoucherReturn } from '../entities/returnVouchers/receiptVoucherReturn.entity';
import { ReceiptVoucherReturnDetail } from '../entities/returnVouchers/receiptVoucherReturnDetails.entity';
import { ReceiptVoucherReturnService } from './receipt-voucher-return.service';
import { ReceiptVoucherReturnController } from './receipt-voucher-return.controller';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReceiptVoucherReturn,
      ReceiptVoucherReturnDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [ReceiptVoucherReturnService],
  controllers: [ReceiptVoucherReturnController],
})
export class ReceiptVoucherReturnModule {}
