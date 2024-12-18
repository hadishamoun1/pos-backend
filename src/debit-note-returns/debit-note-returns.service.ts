import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { DebitNoteReturn } from '../entities/returnVouchers/debitNoteReturn.entity';
import { DebitNoteReturnDetail } from '../entities/returnVouchers/debitNoteReturnDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class DebitNoteReturnService {
  constructor(
    @InjectRepository(DebitNoteReturn)
    private readonly debitNoteReturnRepository: Repository<DebitNoteReturn>,
    @InjectRepository(DebitNoteReturnDetail)
    private readonly debitNoteReturnDetailRepository: Repository<DebitNoteReturnDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createDebitNoteReturn(
    data: Partial<DebitNoteReturn>,
  ): Promise<DebitNoteReturn> {
    const { account, details, ...otherData } = data;

    const selectedAccount = await this.accountRepository.findOne({
      where: { id: account.id },
    });
    if (!selectedAccount) {
      throw new NotFoundException(`Account with ID ${account.id} not found.`);
    }

    const exchangeRateAcc = await this.currencyRateRepository.findOne({
      where: { currency: selectedAccount.currency },
    });
    if (!exchangeRateAcc) {
      throw new NotFoundException(
        `Exchange rate not found for currency of account ID ${selectedAccount.id}.`,
      );
    }

    const exchangeRateUSD = await this.currencyRateRepository.findOne({
      where: { currency: { currencyCode: 'USD' } },
    });
    if (!exchangeRateUSD) {
      throw new NotFoundException(`Exchange rate for USD not found.`);
    }

    const lastVoucher = await this.debitNoteReturnRepository.find({
      where: { dnReturnNumber: Like('DNR - %') },
      order: { dnReturnNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].dnReturnNumber.split(' - ')[1], 10) + 1
        : 1;
    const dnReturnNumber = `DNR - ${nextNumber}`;

    const returnDetails = await Promise.all(
      details.map(async (detail) => {
        const detailAccount = await this.accountRepository.findOne({
          where: { id: detail.account.id },
        });
        if (!detailAccount) {
          throw new NotFoundException(
            `Account with ID ${detail.account.id} not found for a detail entry.`,
          );
        }

        return this.debitNoteReturnDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    const debitNoteReturn = this.debitNoteReturnRepository.create({
      ...otherData,
      dnReturnNumber,
      account: selectedAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: returnDetails,
    });

    return this.debitNoteReturnRepository.save(debitNoteReturn);
  }

  async getAllDebitNoteReturns(): Promise<DebitNoteReturn[]> {
    return this.debitNoteReturnRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getDebitNoteReturnById(id: number): Promise<DebitNoteReturn> {
    const debitNoteReturn = await this.debitNoteReturnRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!debitNoteReturn) {
      throw new NotFoundException(`Debit Note Return with ID ${id} not found.`);
    }
    return debitNoteReturn;
  }

  async updateDebitNoteReturn(
    id: number,
    data: Partial<DebitNoteReturn>,
  ): Promise<DebitNoteReturn> {
    const debitNoteReturn = await this.getDebitNoteReturnById(id);
    Object.assign(debitNoteReturn, data);
    return this.debitNoteReturnRepository.save(debitNoteReturn);
  }

  async deleteDebitNoteReturn(id: number): Promise<void> {
    const debitNoteReturn = await this.getDebitNoteReturnById(id);
    await this.debitNoteReturnRepository.remove(debitNoteReturn);
  }
}
