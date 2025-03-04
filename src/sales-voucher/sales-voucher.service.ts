import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity';
import { SalesVoucherDetail } from '../entities/Vouchers/salesVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class SalesVoucherService {
  constructor(
    @InjectRepository(SalesVoucher)
    private readonly salesVoucherRepository: Repository<SalesVoucher>,

    @InjectRepository(SalesVoucherDetail)
    private readonly salesVoucherDetailRepository: Repository<SalesVoucherDetail>,

    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,

    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createSalesVoucher(data: Partial<SalesVoucher>): Promise<SalesVoucher> {
    const { details, ...otherData } = data;

    // Fetch exchange rates (USD & Transaction Currency)
    const exchangeRateUSD = await this.currencyRateRepository.findOne({
      where: { currency: { currencyCode: 'USD' } },
    });

    if (!exchangeRateUSD) {
      throw new NotFoundException(`Exchange rate for USD not found.`);
    }

    // Generate the SV number
    const lastVoucher = await this.salesVoucherRepository.find({
      where: { svNumber: Like('SV - %') },
      order: { svNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].svNumber.split(' - ')[1], 10) + 1
        : 1;
    const svNumber = `SV - ${nextNumber}`;

    // Create Sales Voucher details
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

        return this.salesVoucherDetailRepository.create({
          ...detail,
          account: detailAccount, // ✅ Use account in `SalesVoucherDetail`
          exchangeRateUSD,
        });
      }),
    );

    // Create and save the Sales Voucher
    const salesVoucher = this.salesVoucherRepository.create({
      ...otherData,
      svNumber,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.salesVoucherRepository.save(salesVoucher);
  }

  async getAllSalesVouchers(): Promise<SalesVoucher[]> {
    return this.salesVoucherRepository.find({
      relations: ['exchangeRateUSD', 'details'],
    });
  }

  async getSalesVoucherById(id: number): Promise<SalesVoucher> {
    const salesVoucher = await this.salesVoucherRepository.findOne({
      where: { id },
      relations: ['exchangeRateUSD', 'details'],
    });
    if (!salesVoucher) {
      throw new NotFoundException(`Sales Voucher with ID ${id} not found.`);
    }
    return salesVoucher;
  }

  async updateSalesVoucher(
    id: number,
    data: Partial<SalesVoucher>,
  ): Promise<SalesVoucher> {
    const salesVoucher = await this.getSalesVoucherById(id);

    Object.assign(salesVoucher, data);
    return this.salesVoucherRepository.save(salesVoucher);
  }

  async deleteSalesVoucher(id: number): Promise<void> {
    const salesVoucher = await this.getSalesVoucherById(id);
    await this.salesVoucherRepository.remove(salesVoucher);
  }
}
