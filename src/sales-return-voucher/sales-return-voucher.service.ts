import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { SalesReturnVoucher } from '../entities/returnVouchers/salesReturnVoucher.entity';
import { SalesReturnVoucherDetail } from '../entities/returnVouchers/salesReturnVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class SalesReturnVoucherService {
  constructor(
    @InjectRepository(SalesReturnVoucher)
    private readonly salesReturnVoucherRepository: Repository<SalesReturnVoucher>,
    @InjectRepository(SalesReturnVoucherDetail)
    private readonly salesReturnVoucherDetailRepository: Repository<SalesReturnVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createSalesReturnVoucher(
    data: Partial<SalesReturnVoucher>,
  ): Promise<SalesReturnVoucher> {
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

    const lastVoucher = await this.salesReturnVoucherRepository.find({
      where: { srNumber: Like('SR - %') },
      order: { srNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].srNumber.split(' - ')[1], 10) + 1
        : 1;
    const srNumber = `SR - ${nextNumber}`;

    const voucherDetails = await Promise.all(
      details.map(async (detail) => {
        const detailAccount = await this.accountRepository.findOne({
          where: { id: detail.account.id },
        });
        if (!detailAccount) {
          throw new NotFoundException(
            `Account with ID ${detail.account.id} not found for a detail entry.`,
          );
        }

        return this.salesReturnVoucherDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    const salesReturnVoucher = this.salesReturnVoucherRepository.create({
      ...otherData,
      srNumber,
      account: selectedAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.salesReturnVoucherRepository.save(salesReturnVoucher);
  }

  async getAllSalesReturnVouchers(): Promise<SalesReturnVoucher[]> {
    return this.salesReturnVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getSalesReturnVoucherById(id: number): Promise<SalesReturnVoucher> {
    const salesReturnVoucher = await this.salesReturnVoucherRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!salesReturnVoucher) {
      throw new NotFoundException(
        `Sales Return Voucher with ID ${id} not found.`,
      );
    }
    return salesReturnVoucher;
  }

  async updateSalesReturnVoucher(
    id: number,
    data: Partial<SalesReturnVoucher>,
  ): Promise<SalesReturnVoucher> {
    const salesReturnVoucher = await this.getSalesReturnVoucherById(id);
    Object.assign(salesReturnVoucher, data);
    return this.salesReturnVoucherRepository.save(salesReturnVoucher);
  }

  async deleteSalesReturnVoucher(id: number): Promise<void> {
    const salesReturnVoucher = await this.getSalesReturnVoucherById(id);
    await this.salesReturnVoucherRepository.remove(salesReturnVoucher);
  }
}
