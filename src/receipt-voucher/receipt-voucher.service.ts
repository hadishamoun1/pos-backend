import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ReceiptVoucher } from '../entities/Vouchers/recieptVoucher.entity';
import { ReceiptVoucherDetail } from '../entities/Vouchers/recieptVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class ReceiptVoucherService {
  constructor(
    @InjectRepository(ReceiptVoucher)
    private readonly receiptVoucherRepository: Repository<ReceiptVoucher>,
    @InjectRepository(ReceiptVoucherDetail)
    private readonly receiptVoucherDetailRepository: Repository<ReceiptVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  // Create a new Receipt Voucher
  async createReceiptVoucher(
    data: Partial<ReceiptVoucher>,
  ): Promise<ReceiptVoucher> {
    const { account, details, ...otherData } = data;

    // Validate the main account
    const mainAccount = await this.accountRepository.findOne({
      where: { id: account.id },
    });
    if (!mainAccount) {
      throw new NotFoundException(`Account with ID ${account.id} not found.`);
    }

    // Fetch the exchange rate for the account's currency
    const exchangeRateAcc = await this.currencyRateRepository.findOne({
      where: { currency: mainAccount.currency },
    });
    if (!exchangeRateAcc) {
      throw new NotFoundException(
        `Exchange rate not found for currency of account ID ${mainAccount.id}`,
      );
    }

    // Fetch the exchange rate for USD
    const exchangeRateUSD = await this.currencyRateRepository.findOne({
      where: { currency: { currencyCode: 'USD' } },
    });
    if (!exchangeRateUSD) {
      throw new NotFoundException(`Exchange rate for USD not found.`);
    }

    // Generate the RV number
    const lastVoucher = await this.receiptVoucherRepository.find({
      where: { rvNumber: Like('RV - %') },
      order: { rvNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].rvNumber.split(' - ')[1], 10) + 1
        : 1;
    const rvNumber = `RV - ${nextNumber}`;

    // Create Receipt Voucher details
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

        return this.receiptVoucherDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    // Create Receipt Voucher
    const receiptVoucher = this.receiptVoucherRepository.create({
      ...otherData,
      rvNumber,
      account: mainAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.receiptVoucherRepository.save(receiptVoucher);
  }

  // Get all Receipt Vouchers
  async getAllReceiptVouchers(): Promise<ReceiptVoucher[]> {
    return this.receiptVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  // Get a single Receipt Voucher by ID
  async getReceiptVoucherById(id: number): Promise<ReceiptVoucher> {
    const receiptVoucher = await this.receiptVoucherRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!receiptVoucher) {
      throw new NotFoundException(`Receipt Voucher with ID ${id} not found.`);
    }
    return receiptVoucher;
  }

  // Update a Receipt Voucher
  async updateReceiptVoucher(
    id: number,
    data: Partial<ReceiptVoucher>,
  ): Promise<ReceiptVoucher> {
    const receiptVoucher = await this.getReceiptVoucherById(id);
    Object.assign(receiptVoucher, data);
    return this.receiptVoucherRepository.save(receiptVoucher);
  }

  // Delete a Receipt Voucher
  async deleteReceiptVoucher(id: number): Promise<void> {
    const receiptVoucher = await this.getReceiptVoucherById(id);
    await this.receiptVoucherRepository.remove(receiptVoucher);
  }
}
