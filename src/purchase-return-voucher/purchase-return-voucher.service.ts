import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { PurchaseReturnVoucher } from '../entities/returnVouchers/purchaseReturnVoucher.entity';
import { PurchaseReturnVoucherDetail } from '../entities/returnVouchers/purchaseReturnVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class PurchaseReturnVoucherService {
  constructor(
    @InjectRepository(PurchaseReturnVoucher)
    private readonly purchaseReturnVoucherRepository: Repository<PurchaseReturnVoucher>,
    @InjectRepository(PurchaseReturnVoucherDetail)
    private readonly purchaseReturnVoucherDetailRepository: Repository<PurchaseReturnVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createPurchaseReturnVoucher(
    data: Partial<PurchaseReturnVoucher>,
  ): Promise<PurchaseReturnVoucher> {
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

    const lastVoucher = await this.purchaseReturnVoucherRepository.find({
      where: { prNumber: Like('PR - %') },
      order: { prNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].prNumber.split(' - ')[1], 10) + 1
        : 1;
    const prNumber = `PR - ${nextNumber}`;

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

        return this.purchaseReturnVoucherDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    const purchaseReturnVoucher = this.purchaseReturnVoucherRepository.create({
      ...otherData,
      prNumber,
      account: selectedAccount,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.purchaseReturnVoucherRepository.save(purchaseReturnVoucher);
  }

  async getAllPurchaseReturnVouchers(): Promise<PurchaseReturnVoucher[]> {
    return this.purchaseReturnVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getPurchaseReturnVoucherById(id: number): Promise<PurchaseReturnVoucher> {
    const purchaseReturnVoucher = await this.purchaseReturnVoucherRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!purchaseReturnVoucher) {
      throw new NotFoundException(`Purchase Return Voucher with ID ${id} not found.`);
    }
    return purchaseReturnVoucher;
  }

  async updatePurchaseReturnVoucher(
    id: number,
    data: Partial<PurchaseReturnVoucher>,
  ): Promise<PurchaseReturnVoucher> {
    const purchaseReturnVoucher = await this.getPurchaseReturnVoucherById(id);
    Object.assign(purchaseReturnVoucher, data);
    return this.purchaseReturnVoucherRepository.save(purchaseReturnVoucher);
  }

  async deletePurchaseReturnVoucher(id: number): Promise<void> {
    const purchaseReturnVoucher = await this.getPurchaseReturnVoucherById(id);
    await this.purchaseReturnVoucherRepository.remove(purchaseReturnVoucher);
  }
}
