import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { CreditNote } from '../entities/Vouchers/creditNote.entity';
import { CreditNoteDetail } from '../entities/Vouchers/creditNoteDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class CreditNoteService {
  constructor(
    @InjectRepository(CreditNote)
    private readonly creditNoteRepository: Repository<CreditNote>,
    @InjectRepository(CreditNoteDetail)
    private readonly creditNoteDetailRepository: Repository<CreditNoteDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createCreditNote(data: Partial<CreditNote>): Promise<CreditNote> {
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

    // Generate the CN number
    const lastNote = await this.creditNoteRepository.find({
      where: { cnNumber: Like('CN - %') },
      order: { cnNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastNote.length > 0
        ? parseInt(lastNote[0].cnNumber.split(' - ')[1], 10) + 1
        : 1;
    const cnNumber = `CN - ${nextNumber}`;

    // Create Credit Note details
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

        return this.creditNoteDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    // Create and save the Credit Note
    const creditNote = this.creditNoteRepository.create({
      ...otherData,
      cnNumber,
      account: accountEntity,
      exchangeRateAcc,
      exchangeRateUSD,
      details: noteDetails,
    });

    return this.creditNoteRepository.save(creditNote);
  }

  async getAllCreditNotes(): Promise<CreditNote[]> {
    return this.creditNoteRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getCreditNoteById(id: number): Promise<CreditNote> {
    const creditNote = await this.creditNoteRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!creditNote) {
      throw new NotFoundException(`Credit Note with ID ${id} not found.`);
    }
    return creditNote;
  }

  async updateCreditNote(
    id: number,
    data: Partial<CreditNote>,
  ): Promise<CreditNote> {
    const creditNote = await this.getCreditNoteById(id);
    Object.assign(creditNote, data);
    return this.creditNoteRepository.save(creditNote);
  }

  async deleteCreditNote(id: number): Promise<void> {
    const creditNote = await this.getCreditNoteById(id);
    await this.creditNoteRepository.remove(creditNote);
  }
}
