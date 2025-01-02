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

  async createMultiplePaymentVouchers(
    transactions: {
      accountId: number; // Main account for the voucher
      date: Date;
      pmNumber: string; // Payment voucher number
      details: {
        cashNumber: string;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required for "LL"
        amountExchanged?: string; // Explicitly for LL
        description?: string; // Optional description
      }[];
    }[],
  ): Promise<PaymentVoucher[]> {
    const paymentVouchers: PaymentVoucher[] = [];
  
    let lastVoucher = await this.paymentVoucherRepository.find({
      where: { pmNumber: Like('PM - %') },
      order: { pmNumber: 'DESC' },
      take: 1,
    });
  
    let nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].pmNumber.split(' - ')[1], 10) + 1
        : 1;
  
    for (const transaction of transactions) {
      const { accountId, date, details } = transaction;
  
      // Validate main account
      const mainAccount = await this.accountRepository.findOne({
        where: { id: accountId },
      });
      if (!mainAccount) {
        throw new NotFoundException(`Account with ID ${accountId} not found.`);
      }
  
      // Fetch exchange rates
      const exchangeRateAcc = await this.currencyRateRepository.findOne({
        where: { currency: mainAccount.currency },
      });
      if (!exchangeRateAcc) {
        throw new NotFoundException(
          `Exchange rate not found for currency of account ID ${accountId}`,
        );
      }
  
      const exchangeRateUSD = await this.currencyRateRepository.findOne({
        where: { currency: { currencyCode: 'USD' } },
      });
      if (!exchangeRateUSD) {
        throw new NotFoundException(`Exchange rate for USD not found.`);
      }
  
      const pmNumber = `PM - ${String(nextNumber++).padStart(3, '0')}`;
  
      let totalDr = 0;
      let totalDrUSD = 0;
      let totalDrLL = 0;
      let totalCr = 0;
      let totalCrUSD = 0;
      let totalCrLL = 0;
  
      const voucherDetails = details.flatMap((detail) => {
        const isUSD = detail.currency === 'USD';
        const cashNumber = parseFloat(detail.cashNumber);
        const exchangeRate = isUSD ? 1 : parseFloat(detail.exchangeRate || '1');
        const amountExchanged = parseFloat(detail.amountExchanged || '0');
  
        // Adjusted logic
        const dr = isUSD ? cashNumber : amountExchanged;
        const drUSD = isUSD ? cashNumber : amountExchanged;
        const drLL = isUSD ? 0 : cashNumber;
  
        const cr = isUSD ? cashNumber : amountExchanged;
        const crUSD = isUSD ? cashNumber : amountExchanged;
        const crLL = isUSD ? 0 : cashNumber;
  
        // Update totals
        totalDr += dr;
        totalDrUSD += drUSD;
        totalDrLL += drLL;
        totalCr += cr;
        totalCrUSD += crUSD;
        totalCrLL += crLL;
  
        // User input (debit) transaction
        const debitDetail = this.paymentVoucherDetailRepository.create({
          dr,
          drUSD,
          drLL,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          account: null, // User input has no account ID
          exchangeRateAcc,
          exchangeRateUSD,
          description: detail.description || null, // Set description from user input
        });
  
        // Auto-generated (credit) transaction
        const creditDetail = this.paymentVoucherDetailRepository.create({
          dr: 0,
          drUSD: 0,
          drLL: 0,
          cr,
          crUSD,
          crLL,
          account: mainAccount, // Auto-generated credit transaction linked to main account
          exchangeRateAcc,
          exchangeRateUSD,
          description: detail.description || null, // Copy description from user input
        });
  
        return [debitDetail, creditDetail];
      });
  
      const paymentVoucher = this.paymentVoucherRepository.create({
        account: mainAccount,
        date,
        pmNumber,
        details: voucherDetails,
        totalDr,
        totalDrUSD,
        totalDrLL,
        totalCr,
        totalCrUSD,
        totalCrLL,
        exchangeRateAcc,
        exchangeRateUSD,
      });
  
      paymentVouchers.push(
        await this.paymentVoucherRepository.save(paymentVoucher),
      );
    }
  
    return paymentVouchers;
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
