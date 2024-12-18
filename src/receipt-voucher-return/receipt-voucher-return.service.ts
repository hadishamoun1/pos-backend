import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ReceiptVoucherReturn } from '../entities/returnVouchers/receiptVoucherReturn.entity';
import { ReceiptVoucherReturnDetail } from '../entities/returnVouchers/receiptVoucherReturnDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class ReceiptVoucherReturnService {
  constructor(
    @InjectRepository(ReceiptVoucherReturn)
    private readonly receiptVoucherReturnRepository: Repository<ReceiptVoucherReturn>,
    @InjectRepository(ReceiptVoucherReturnDetail)
    private readonly receiptVoucherReturnDetailRepository: Repository<ReceiptVoucherReturnDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createReceiptVoucherReturn(
    data: Partial<ReceiptVoucherReturn>,
  ): Promise<ReceiptVoucherReturn> {
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

    const lastVoucher = await this.receiptVoucherReturnRepository.find({
      where: { rvrNumber: Like('RVR - %') },
      order: { rvrNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].rvrNumber.split(' - ')[1], 10) + 1
        : 1;
    const rvrNumber = `RVR - ${nextNumber}`;

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

        return this.receiptVoucherReturnDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    const receiptVoucherReturn = this.receiptVoucherReturnRepository.create({
      ...otherData,
      rvrNumber,
      account: selectedAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.receiptVoucherReturnRepository.save(receiptVoucherReturn);
  }

  async getAllReceiptVoucherReturns(): Promise<ReceiptVoucherReturn[]> {
    return this.receiptVoucherReturnRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getReceiptVoucherReturnById(id: number): Promise<ReceiptVoucherReturn> {
    const receiptVoucherReturn =
      await this.receiptVoucherReturnRepository.findOne({
        where: { id },
        relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
      });
    if (!receiptVoucherReturn) {
      throw new NotFoundException(
        `Receipt Voucher Return with ID ${id} not found.`,
      );
    }
    return receiptVoucherReturn;
  }

  async updateReceiptVoucherReturn(
    id: number,
    data: Partial<ReceiptVoucherReturn>,
  ): Promise<ReceiptVoucherReturn> {
    const receiptVoucherReturn = await this.getReceiptVoucherReturnById(id);
    Object.assign(receiptVoucherReturn, data);
    return this.receiptVoucherReturnRepository.save(receiptVoucherReturn);
  }

  async deleteReceiptVoucherReturn(id: number): Promise<void> {
    const receiptVoucherReturn = await this.getReceiptVoucherReturnById(id);
    await this.receiptVoucherReturnRepository.remove(receiptVoucherReturn);
  }
}
