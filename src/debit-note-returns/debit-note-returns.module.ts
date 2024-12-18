import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebitNoteReturn } from '../entities/returnVouchers/debitNoteReturn.entity';
import { DebitNoteReturnDetail } from '../entities/returnVouchers/debitNoteReturnDetails.entity';
import { DebitNoteReturnService } from './debit-note-returns.service';
import { DebitNoteReturnController } from './debit-note-returns.controller';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DebitNoteReturn,
      DebitNoteReturnDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  providers: [DebitNoteReturnService],
  controllers: [DebitNoteReturnController],
})
export class DebitNoteReturnModule {}
