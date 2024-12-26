import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReceiptVoucher } from '../entities/Vouchers/recieptVoucher.entity';
import { ReceiptVoucherDetail } from '../entities/Vouchers/recieptVoucherDetails.entity';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { ReceiptVoucherController } from './receipt-voucher.controller';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { Customer } from 'src/entities/customer.entity';
import { ReceiptVoucherGateway } from './receipt-voucher-gateway.broadcast';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      ReceiptVoucher,
      ReceiptVoucherDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [ReceiptVoucherService, ReceiptVoucherGateway],
  controllers: [ReceiptVoucherController],
})
export class ReceiptVoucherModule {}
