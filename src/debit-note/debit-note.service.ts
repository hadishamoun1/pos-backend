import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { DebitNote } from '../entities/Vouchers/debitNote.entity';
import { DebitNoteDetail } from '../entities/Vouchers/debitNoteDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class DebitNoteService {
  constructor(
    @InjectRepository(DebitNote)
    private readonly debitNoteRepository: Repository<DebitNote>,
    @InjectRepository(DebitNoteDetail)
    private readonly debitNoteDetailRepository: Repository<DebitNoteDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createDebitNote(data: Partial<DebitNote>): Promise<DebitNote> {
    const { account, details, ...otherData } = data;

    // Validate the account
    const accountEntity = await this.accountRepository.findOne({
      where: { id: account.id },
    });
    if (!accountEntity) {
      throw new NotFoundException(`Account with ID ${account.id} not found.`);
    }

    // Fetch exchange rates
    const exchangeRateAcc = await this.currencyRateRepository.findOne({
      where: { currency: accountEntity.currency },
    });
    if (!exchangeRateAcc) {
      throw new NotFoundException(
        `Exchange rate not found for currency of account ID ${account.id}`,
      );
    }

    const exchangeRateUSD = await this.currencyRateRepository.findOne({
      where: { currency: { currencyCode: 'USD' } },
    });
    if (!exchangeRateUSD) {
      throw new NotFoundException(`Exchange rate for USD not found.`);
    }

    // Generate the DN number
    const lastNote = await this.debitNoteRepository.find({
      where: { dnNumber: Like('DN - %') },
      order: { dnNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastNote.length > 0
        ? parseInt(lastNote[0].dnNumber.split(' - ')[1], 10) + 1
        : 1;
    const dnNumber = `DN - ${nextNumber}`;

    // Create Debit Note details
    const noteDetails = await Promise.all(
      details.map(async (detail) => {
        const detailAccount = await this.accountRepository.findOne({
          where: { id: detail.account.id },
        });
        if (!detailAccount) {
          throw new NotFoundException(
            `Account with ID ${detail.account.id} not found for a detail entry.`,
          );
        }

        return this.debitNoteDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    // Create and save the Debit Note
    const debitNote = this.debitNoteRepository.create({
      ...otherData,
      dnNumber,
      account: accountEntity,
      exchangeRateAcc,
      exchangeRateUSD,
      details: noteDetails,
    });

    return this.debitNoteRepository.save(debitNote);
  }

  async getAllDebitNotes(): Promise<DebitNote[]> {
    return this.debitNoteRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getDebitNoteById(id: number): Promise<DebitNote> {
    const debitNote = await this.debitNoteRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!debitNote) {
      throw new NotFoundException(`Debit Note with ID ${id} not found.`);
    }
    return debitNote;
  }

  async updateDebitNote(
    id: number,
    data: Partial<DebitNote>,
  ): Promise<DebitNote> {
    const debitNote = await this.getDebitNoteById(id);
    Object.assign(debitNote, data);
    return this.debitNoteRepository.save(debitNote);
  }

  async deleteDebitNote(id: number): Promise<void> {
    const debitNote = await this.getDebitNoteById(id);
    await this.debitNoteRepository.remove(debitNote);
  }
}
