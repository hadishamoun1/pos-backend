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
      supplierId: number;
      date: Date;
      invoiceId: string;
      paymentType: string;
      type: string; // "S" or "G"
      doneBy: string;
      details: {
        amount: number;
        currency: string;
        exchangeRate?: string;
        checkNumber?: string;
        checkDate?: Date;
        bankName?: string;
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
      const {
        supplierId,
        date,
        invoiceId,
        paymentType,
        type,
        doneBy,
        details,
      } = transaction;

      const supplier = await this.supplierRepository.findOne({
        where: { id: supplierId },
      });
      if (!supplier) {
        throw new NotFoundException(
          `Supplier with ID ${supplierId} not found.`,
        );
      }

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
      let totalDr = 0,
        totalCr = 0,
        totalDrUSD = 0,
        totalDrLL = 0,
        totalCrUSD = 0,
        totalCrLL = 0;

      const voucherDetails = details.flatMap((detail) => {
        const isUSD = detail.currency === 'USD';
        const amount = detail.amount;
        const exchangeRate = isUSD ? 1 : parseFloat(detail.exchangeRate || '1');
        const amountExchanged = isUSD ? amount : amount / exchangeRate;

        const dr = amountExchanged;
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

        const debitDetail = this.paymentVoucherDetailRepository.create({
          dr,
          drUSD,
          drLL,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          exchangeRate,
          checkNumber: detail.checkNumber || null,
          checkDate: detail.checkDate || null,
          bankName: detail.bankName || null,
          description: detail.description || null,
          account: null,
        });

        const creditDetail = this.paymentVoucherDetailRepository.create({
          dr: 0,
          drUSD: 0,
          drLL: 0,
          cr,
          crUSD,
          crLL,
          exchangeRate,
          account: isUSD ? usdAccount : llAccount,
        });

        return [debitDetail, creditDetail];
      });

      const paymentVoucher = this.paymentVoucherRepository.create({
        supplier,
        date,
        pmNumber,
        invoiceId,
        paymentType,
        type,
        doneBy,
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
