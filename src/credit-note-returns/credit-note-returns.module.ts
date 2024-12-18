import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditNoteReturn } from '../entities/returnVouchers/creditNoteReturn.entity';
import { CreditNoteReturnDetail } from '../entities/returnVouchers/creditNoteReturnDetails.entity';
import { CreditNoteReturnService } from './credit-note-returns.service';
import { CreditNoteReturnController } from './credit-note-returns.controller';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CreditNoteReturn,
      CreditNoteReturnDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [CreditNoteReturnService],
  controllers: [CreditNoteReturnController],
})
export class CreditNoteReturnModule {}
