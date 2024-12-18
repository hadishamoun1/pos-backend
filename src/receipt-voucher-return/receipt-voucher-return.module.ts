import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReceiptVoucherReturn } from '../entities/Vouchers/receiptVoucherReturn.entity';
import { ReceiptVoucherReturnDetail } from '../entities/Vouchers/receiptVoucherReturnDetails.entity';
import { ReceiptVoucherReturnService } from '../services/receiptVoucherReturn.service';
import { ReceiptVoucherReturnController } from '../controllers/receiptVoucherReturn.controller';
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
