import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { Customer } from '../entities/customer.entity';
import { Account } from '../entities/account.entity';

@Injectable()
export class PaymentVoucherService {
  constructor(
    @InjectRepository(PaymentVoucher)
    private readonly paymentVoucherRepository: Repository<PaymentVoucher>,
    @InjectRepository(PaymentVoucherDetail)
    private readonly paymentVoucherDetailRepository: Repository<PaymentVoucherDetail>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  async createMultiplePaymentVouchers(
    transactions: {
      customerId: number;
      date: Date;
      details: {
        cashNumber: string;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Required for "LL"
        description?: string;
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
      const { customerId, date, details } = transaction;

      // Validate customer
      const customer = await this.customerRepository.findOne({
        where: { id: customerId },
      });
      if (!customer) {
        throw new NotFoundException(
          `Customer with ID ${customerId} not found.`,
        );
      }

      // Fetch accounts for currency handling
      const usdAccount = await this.accountRepository.findOne({
        where: { accountNumber: '5301' },
      });
      if (!usdAccount) {
        throw new NotFoundException(`Account with number 5301 not found.`);
      }

      const llAccount = await this.accountRepository.findOne({
        where: { accountNumber: '5302' },
      });
      if (!llAccount) {
        throw new NotFoundException(`Account with number 5302 not found.`);
      }

      const pmNumber = `PM - ${String(nextNumber++).padStart(3, '0')}`;
      let totalDr = 0;
      let totalCr = 0;
      let totalDrUSD = 0;
      let totalDrLL = 0;
      let totalCrUSD = 0;
      let totalCrLL = 0;

      const voucherDetails = details.flatMap((detail) => {
        const isUSD = detail.currency === 'USD';
        const cashNumber = parseFloat(detail.cashNumber);
        const exchangeRate = isUSD ? 1 : parseFloat(detail.exchangeRate || '1');

        const dr = isUSD ? cashNumber : cashNumber / exchangeRate;
        const cr = dr;
        const drUSD = isUSD ? cashNumber : cashNumber / exchangeRate;
        const drLL = isUSD ? 0 : cashNumber;

        const crUSD = drUSD;
        const crLL = drLL;

        totalDr += dr;
        totalDrUSD += drUSD;
        totalDrLL += drLL;
        totalCr += cr;
        totalCrUSD += crUSD;
        totalCrLL += crLL;

        // Debit transaction (user input)
        const debitDetail = this.paymentVoucherDetailRepository.create({
          dr,
          drUSD,
          drLL,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          account: null, // User input has no account ID
          description: detail.description || null,
        });

        // Credit transaction (auto-generated)
        const creditDetail = this.paymentVoucherDetailRepository.create({
          dr: 0,
          drUSD: 0,
          drLL: 0,
          cr,
          crUSD,
          crLL,
          account: isUSD ? usdAccount : llAccount,
          description: detail.description || null,
        });

        return [debitDetail, creditDetail];
      });

      const paymentVoucher = this.paymentVoucherRepository.create({
        customer,
        date,
        pmNumber,
        details: voucherDetails,
        totalDr,
        totalDrUSD,
        totalDrLL,
        totalCr,
        totalCrUSD,
        totalCrLL,
      });

      paymentVouchers.push(
        await this.paymentVoucherRepository.save(paymentVoucher),
      );
    }

    return paymentVouchers;
  }
}
