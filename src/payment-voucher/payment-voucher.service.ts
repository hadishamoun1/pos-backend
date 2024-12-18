import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class PaymentVoucherService {
  constructor(
    @InjectRepository(PaymentVoucher)
    private readonly paymentVoucherRepository: Repository<PaymentVoucher>,
    @InjectRepository(PaymentVoucherDetail)
    private readonly paymentVoucherDetailRepository: Repository<PaymentVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  // Create a new Payment Voucher
  async createPaymentVoucher(
    data: Partial<PaymentVoucher>,
  ): Promise<PaymentVoucher> {
    const { account, details, ...otherData } = data;

    // Validate the main account
    const accountEntity = await this.accountRepository.findOne({
      where: { id: account.id },
    });
    if (!accountEntity) {
      throw new NotFoundException(
        `Account with ID ${account.id} not found.`,
      );
    }

    // Fetch exchange rates
    const exchangeRateAcc = await this.currencyRateRepository.findOne({
      where: { currency: accountEntity.currency },
    });
    if (!exchangeRateAcc) {
      throw new NotFoundException(
        `Exchange rate not found for currency of account ID ${accountEntity.id}`,
      );
    }

    const exchangeRateUSD = await this.currencyRateRepository.findOne({
      where: { currency: { currencyCode: 'USD' } },
    });
    if (!exchangeRateUSD) {
      throw new NotFoundException(`Exchange rate for USD not found.`);
    }

    // Generate the PM number
    const lastVoucher = await this.paymentVoucherRepository.find({
      where: { pmNumber: Like('PM - %') },
      order: { pmNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].pmNumber.split(' - ')[1], 10) + 1
        : 1;
    const pmNumber = `PM - ${nextNumber}`;

    // Validate and create Payment Voucher details
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

        return this.paymentVoucherDetailRepository.create({
          ...detail,
          account: detailAccount,
          exchangeRateAcc,
          exchangeRateUSD,
        });
      }),
    );

    // Create and save the Payment Voucher
    const paymentVoucher = this.paymentVoucherRepository.create({
      ...otherData,
      pmNumber,
      account: accountEntity,
      exchangeRateAcc,
      exchangeRateUSD,
      details: voucherDetails,
    });

    return this.paymentVoucherRepository.save(paymentVoucher);
  }

  // Get all Payment Vouchers
  async getAllPaymentVouchers(): Promise<PaymentVoucher[]> {
    return this.paymentVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  // Get a single Payment Voucher by ID
  async getPaymentVoucherById(id: number): Promise<PaymentVoucher> {
    const paymentVoucher = await this.paymentVoucherRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!paymentVoucher) {
      throw new NotFoundException(`Payment Voucher with ID ${id} not found.`);
    }
    return paymentVoucher;
  }

  // Update a Payment Voucher
  async updatePaymentVoucher(
    id: number,
    data: Partial<PaymentVoucher>,
  ): Promise<PaymentVoucher> {
    const paymentVoucher = await this.getPaymentVoucherById(id);
    Object.assign(paymentVoucher, data);
    return this.paymentVoucherRepository.save(paymentVoucher);
  }

  // Delete a Payment Voucher
  async deletePaymentVoucher(id: number): Promise<void> {
    const paymentVoucher = await this.getPaymentVoucherById(id);
    await this.paymentVoucherRepository.remove(paymentVoucher);
  }
}
