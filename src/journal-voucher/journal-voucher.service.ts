import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class JournalVoucherService {
  constructor(
    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepository: Repository<JournalVoucher>,
    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepository: Repository<JournalVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createJournalVoucher(
    data: Partial<JournalVoucher>,
  ): Promise<JournalVoucher> {
    const { account, details, ...otherData } = data;

    // Validate the main account
    if (!account || !account.id) {
      throw new NotFoundException(`Account is missing or invalid.`);
    }

    const mainAccount = await this.accountRepository.findOne({
      where: { id: account.id },
    });
    if (!mainAccount) {
      throw new NotFoundException(
        `Main account with ID ${account.id} not found.`,
      );
    }

    // Fetch exchange rates
    const exchangeRateAcc = await this.currencyRateRepository.findOne({
      where: { currency: mainAccount.currency },
    });
    if (!exchangeRateAcc) {
      throw new NotFoundException(
        `Exchange rate not found for currency of account ID ${mainAccount.id}`,
      );
    }

    const exchangeRateUSD = await this.currencyRateRepository.findOne({
      where: { currency: { currencyCode: 'USD' } },
    });
    if (!exchangeRateUSD) {
      throw new NotFoundException(`Exchange rate for USD not found.`);
    }

    // Generate the JV number
    const lastVoucher = await this.journalVoucherRepository.find({
      where: { jvNumber: Like('JV - %') },
      order: { jvNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].jvNumber.split(' - ')[1], 10) + 1
        : 1;
    const jvNumber = `JV - ${nextNumber}`;

    // Create Journal Voucher details
    const voucherDetails = await Promise.all(
      details.map(async (detail) => {
        if (!detail.account || !detail.account.id) {
          throw new NotFoundException(
            `Account for detail entry is missing or invalid.`,
          );
        }

        const detailAccount = await this.accountRepository.findOne({
          where: { id: detail.account.id },
        });
        if (!detailAccount) {
          throw new NotFoundException(
            `Account with ID ${detail.account.id} not found for a detail entry.`,
          );
        }

        return this.journalVoucherDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    // Create and save the Journal Voucher
    const journalVoucher = this.journalVoucherRepository.create({
      ...otherData,
      jvNumber,
      account: mainAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.journalVoucherRepository.save(journalVoucher);
  }

  async getAllJournalVouchers(): Promise<JournalVoucher[]> {
    return this.journalVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getJournalVoucherById(id: number): Promise<JournalVoucher> {
    const journalVoucher = await this.journalVoucherRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!journalVoucher) {
      throw new NotFoundException(`Journal Voucher with ID ${id} not found.`);
    }
    return journalVoucher;
  }

  async updateJournalVoucher(
    id: number,
    data: Partial<JournalVoucher>,
  ): Promise<JournalVoucher> {
    const journalVoucher = await this.getJournalVoucherById(id);
    Object.assign(journalVoucher, data);
    return this.journalVoucherRepository.save(journalVoucher);
  }

  async deleteJournalVoucher(id: number): Promise<void> {
    const journalVoucher = await this.getJournalVoucherById(id);
    await this.journalVoucherRepository.remove(journalVoucher);
  }
}
