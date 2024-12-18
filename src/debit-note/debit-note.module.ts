import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebitNote } from '../entities/Vouchers/debitNote.entity';
import { DebitNoteDetail } from '../entities/Vouchers/debitNoteDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { DebitNoteService } from './debit-note.service';
import { DebitNoteController } from './debit-note.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DebitNote,
      DebitNoteDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  controllers: [DebitNoteController],
  providers: [DebitNoteService],
})
export class DebitNoteModule {}
