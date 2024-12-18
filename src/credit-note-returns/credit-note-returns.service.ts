import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { CreditNoteReturn } from '../entities/returnVouchers/creditNoteReturn.entity';
import { CreditNoteReturnDetail } from '../entities/returnVouchers/creditNoteReturnDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class CreditNoteReturnService {
  constructor(
    @InjectRepository(CreditNoteReturn)
    private readonly creditNoteReturnRepository: Repository<CreditNoteReturn>,
    @InjectRepository(CreditNoteReturnDetail)
    private readonly creditNoteReturnDetailRepository: Repository<CreditNoteReturnDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createCreditNoteReturn(
    data: Partial<CreditNoteReturn>,
  ): Promise<CreditNoteReturn> {
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

    const lastVoucher = await this.creditNoteReturnRepository.find({
      where: { cnReturnNumber: Like('CNR - %') },
      order: { cnReturnNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].cnReturnNumber.split(' - ')[1], 10) + 1
        : 1;
    const cnReturnNumber = `CNR - ${nextNumber}`;

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

        return this.creditNoteReturnDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    const creditNoteReturn = this.creditNoteReturnRepository.create({
      ...otherData,
      cnReturnNumber,
      account: selectedAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: returnDetails,
    });

    return this.creditNoteReturnRepository.save(creditNoteReturn);
  }

  async getAllCreditNoteReturns(): Promise<CreditNoteReturn[]> {
    return this.creditNoteReturnRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getCreditNoteReturnById(id: number): Promise<CreditNoteReturn> {
    const creditNoteReturn = await this.creditNoteReturnRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!creditNoteReturn) {
      throw new NotFoundException(
        `Credit Note Return with ID ${id} not found.`,
      );
    }
    return creditNoteReturn;
  }

  async updateCreditNoteReturn(
    id: number,
    data: Partial<CreditNoteReturn>,
  ): Promise<CreditNoteReturn> {
    const creditNoteReturn = await this.getCreditNoteReturnById(id);
    Object.assign(creditNoteReturn, data);
    return this.creditNoteReturnRepository.save(creditNoteReturn);
  }

  async deleteCreditNoteReturn(id: number): Promise<void> {
    const creditNoteReturn = await this.getCreditNoteReturnById(id);
    await this.creditNoteReturnRepository.remove(creditNoteReturn);
  }
}
