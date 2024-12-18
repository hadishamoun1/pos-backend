import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditNote } from '../entities/Vouchers/creditNote.entity';
import { CreditNoteDetail } from '../entities/Vouchers/creditNoteDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { CreditNoteService } from './credit-note.service';
import { CreditNoteController } from './credit-note.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CreditNote,
      CreditNoteDetail,
      Account,
      CurrencyRate,
    ]),
  ],
  controllers: [CreditNoteController],
  providers: [CreditNoteService],
})
export class CreditNoteModule {}
