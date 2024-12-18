import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { PurchaseVoucherDetail } from '../entities/Vouchers/purchaseVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class PurchaseVoucherService {
  constructor(
    @InjectRepository(PurchaseVoucher)
    private readonly purchaseVoucherRepository: Repository<PurchaseVoucher>,
    @InjectRepository(PurchaseVoucherDetail)
    private readonly purchaseVoucherDetailRepository: Repository<PurchaseVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  // Create a new Purchase Voucher
  async createPurchaseVoucher(
    data: Partial<PurchaseVoucher>,
  ): Promise<PurchaseVoucher> {
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

    // Generate the PV number
    const lastVoucher = await this.purchaseVoucherRepository.find({
      where: { pvNumber: Like('PV - %') },
      order: { pvNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].pvNumber.split(' - ')[1], 10) + 1
        : 1;
    const pvNumber = `PV - ${nextNumber}`;

    // Create Purchase Voucher details
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

        return this.purchaseVoucherDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    // Create and save the Purchase Voucher
    const purchaseVoucher = this.purchaseVoucherRepository.create({
      ...otherData,
      pvNumber,
      account: accountEntity,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.purchaseVoucherRepository.save(purchaseVoucher);
  }

  // Get all Purchase Vouchers
  async getAllPurchaseVouchers(): Promise<PurchaseVoucher[]> {
    return this.purchaseVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  // Get a single Purchase Voucher by ID
  async getPurchaseVoucherById(id: number): Promise<PurchaseVoucher> {
    const purchaseVoucher = await this.purchaseVoucherRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!purchaseVoucher) {
      throw new NotFoundException(`Purchase Voucher with ID ${id} not found.`);
    }
    return purchaseVoucher;
  }

  // Update a Purchase Voucher
  async updatePurchaseVoucher(
    id: number,
    data: Partial<PurchaseVoucher>,
  ): Promise<PurchaseVoucher> {
    const purchaseVoucher = await this.getPurchaseVoucherById(id);
    Object.assign(purchaseVoucher, data);
    return this.purchaseVoucherRepository.save(purchaseVoucher);
  }

  // Delete a Purchase Voucher
  async deletePurchaseVoucher(id: number): Promise<void> {
    const purchaseVoucher = await this.getPurchaseVoucherById(id);
    await this.purchaseVoucherRepository.remove(purchaseVoucher);
  }
}
