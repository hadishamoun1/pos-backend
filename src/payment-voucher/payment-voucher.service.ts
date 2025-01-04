import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { PaymentVoucher } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { Supplier } from '../entities/supplier.entity';
import { Account } from '../entities/account.entity';

@Injectable()
export class PaymentVoucherService {
  constructor(
    @InjectRepository(PaymentVoucher)
    private readonly paymentVoucherRepository: Repository<PaymentVoucher>,
    @InjectRepository(PaymentVoucherDetail)
    private readonly paymentVoucherDetailRepository: Repository<PaymentVoucherDetail>,
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  async createMultiplePaymentVouchers(
    transactions: {
      supplierId: number; // Changed from customerId to supplierId
      date: Date;
      invoiceId: string;
      details: {
        amount: number;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required for "LL"
        checkNumber?: string;
        bankName?: string;
        description?: string; // Optional description
        paymentNumber: string;
        type: string; // Type (e.g., "S" or "G")
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
      const { supplierId, date, invoiceId, details } = transaction;

      // Validate supplier
      const supplier = await this.supplierRepository.findOne({
        where: { id: supplierId },
      });
      if (!supplier) {
        throw new NotFoundException(
          `Supplier with ID ${supplierId} not found.`,
        );
      }

      // Fetch accounts for USD and LL
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
        const amount = parseFloat(detail.amount.toString());
        const exchangeRate = isUSD ? 1 : parseFloat(detail.exchangeRate || '1');
        const amountExchanged = isUSD ? amount : amount / exchangeRate;

        const dr = isUSD ? amount : amount / exchangeRate;
        const drUSD = isUSD ? amount : amount / exchangeRate;
        const drLL = isUSD ? 0 : amount;

        const cr = dr;
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
          exchangeRate,
          checkNumber: detail.checkNumber || null,
          bankName: detail.bankName || null,
          description: detail.description || null,
          account: null, // User input has no account ID
        });

        // Credit transaction (auto-generated)
        const creditDetail = this.paymentVoucherDetailRepository.create({
          dr: 0,
          drUSD: 0,
          drLL: 0,
          cr,
          crUSD,
          crLL,
          exchangeRate,
          account: isUSD ? usdAccount : llAccount, // Auto-linked account
        });

        return [debitDetail, creditDetail];
      });

      const paymentVoucher = this.paymentVoucherRepository.create({
        supplier,
        date,
        pmNumber,
        invoiceId,
        details: voucherDetails,
        totalDr,
        totalDrUSD,
        totalDrLL,
        totalCr,
        totalCrUSD,
        totalCrLL,
        paymentType: details[0].type || null, // Use the type from the first detail
        type: details[0].type || null,
      });

      paymentVouchers.push(
        await this.paymentVoucherRepository.save(paymentVoucher),
      );
    }

    return paymentVouchers;
  }
}
