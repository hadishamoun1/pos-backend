import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { PaymentVoucherReturn } from '../entities/returnVouchers/paymentVoucherReturn.entity';
import { PaymentVoucherReturnDetail } from '../entities/returnVouchers/paymentVoucherReturnDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class PaymentVoucherReturnService {
  constructor(
    @InjectRepository(PaymentVoucherReturn)
    private readonly paymentVoucherReturnRepository: Repository<PaymentVoucherReturn>,
    @InjectRepository(PaymentVoucherReturnDetail)
    private readonly paymentVoucherReturnDetailRepository: Repository<PaymentVoucherReturnDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createPaymentVoucherReturn(
    data: Partial<PaymentVoucherReturn>,
  ): Promise<PaymentVoucherReturn> {
    const { account, details, ...otherData } = data;

    const selectedAccount = await this.accountRepository.findOne({
      where: { id: account.id },
    });
    if (!selectedAccount) {
      throw new NotFoundException(
        `Account with ID ${account.id} not found.`,
      );
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

    const lastVoucher = await this.paymentVoucherReturnRepository.find({
      where: { pvrNumber: Like('PVR - %') },
      order: { pvrNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].pvrNumber.split(' - ')[1], 10) + 1
        : 1;
    const pvrNumber = `PVR - ${nextNumber}`;

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

        return this.paymentVoucherReturnDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    const paymentVoucherReturn = this.paymentVoucherReturnRepository.create({
      ...otherData,
      pvrNumber,
      account: selectedAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.paymentVoucherReturnRepository.save(paymentVoucherReturn);
  }

  async getAllPaymentVoucherReturns(): Promise<PaymentVoucherReturn[]> {
    return this.paymentVoucherReturnRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getPaymentVoucherReturnById(
    id: number,
  ): Promise<PaymentVoucherReturn> {
    const paymentVoucherReturn = await this.paymentVoucherReturnRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!paymentVoucherReturn) {
      throw new NotFoundException(
        `Payment Voucher Return with ID ${id} not found.`,
      );
    }
    return paymentVoucherReturn;
  }

  async updatePaymentVoucherReturn(
    id: number,
    data: Partial<PaymentVoucherReturn>,
  ): Promise<PaymentVoucherReturn> {
    const paymentVoucherReturn = await this.getPaymentVoucherReturnById(id);
    Object.assign(paymentVoucherReturn, data);
    return this.paymentVoucherReturnRepository.save(paymentVoucherReturn);
  }

  async deletePaymentVoucherReturn(id: number): Promise<void> {
    const paymentVoucherReturn = await this.getPaymentVoucherReturnById(id);
    await this.paymentVoucherReturnRepository.remove(paymentVoucherReturn);
  }
}
