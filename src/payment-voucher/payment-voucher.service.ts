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
        checkDueDate?: Date;
        bankName?: string;
        description?: string;
      }[];
    }[],
  ): Promise<PaymentVoucher[]> {
    const paymentVouchers: PaymentVoucher[] = [];

    // Fetch the latest voucher numbers for each type
    const latestSVoucher = await this.paymentVoucherRepository.find({
      where: { pmNumber: Like('PM - %'), type: 'S' },
      order: { pmNumber: 'DESC' },
      take: 1,
    });

    const latestGVoucher = await this.paymentVoucherRepository.find({
      where: { pmNumber: Like('PMG - %'), type: 'G' },
      order: { pmNumber: 'DESC' },
      take: 1,
    });

    let nextSNumber =
      latestSVoucher.length > 0
        ? parseInt(latestSVoucher[0].pmNumber.split(' - ')[1], 10) + 1
        : 1;

    let nextGNumber =
      latestGVoucher.length > 0
        ? parseInt(latestGVoucher[0].pmNumber.split(' - ')[1], 10) + 1
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

      // Determine the payment number based on the type
      const pmNumber =
        type === 'S'
          ? `PM - ${String(nextSNumber++).padStart(4, '0')}`
          : `PMG - ${String(nextGNumber++).padStart(4, '0')}`;

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
          checkDueDate: detail.checkDueDate || null,
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
          checkNumber: detail.checkNumber || null, // Copy from user input
          checkDueDate: detail.checkDueDate || null,
          bankName: detail.bankName || null, // Copy from user input
          checkDate: detail.checkDate || null, // Copy from user input
          description: detail.description || null, // Copy from user input
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

  async editPaymentVoucher(
    id: number,
    updateData: {
      supplierId?: number;
      date?: Date;
      invoiceId?: string;
      paymentType?: string;
      type?: string;
      doneBy?: string;
      details?: {
        amount: number;
        currency: string;
        exchangeRate?: string;
        checkNumber?: string;
        checkDate?: Date;
        checkDueDate?: Date;
        bankName?: string;
        description?: string;
      }[];
    },
  ): Promise<PaymentVoucher> {
    // Find the existing payment voucher
    const paymentVoucher = await this.paymentVoucherRepository.findOne({
      where: { id },
      relations: ['details', 'supplier'],
    });

    if (!paymentVoucher) {
      throw new NotFoundException(`Payment voucher with ID ${id} not found.`);
    }

    // Update supplier if provided
    if (updateData.supplierId) {
      const supplier = await this.supplierRepository.findOne({
        where: { id: updateData.supplierId },
      });

      if (!supplier) {
        throw new NotFoundException(
          `Supplier with ID ${updateData.supplierId} not found.`,
        );
      }

      paymentVoucher.supplier = supplier;
    }

    // Update other basic fields
    if (updateData.date) paymentVoucher.date = updateData.date;
    if (updateData.invoiceId) paymentVoucher.invoiceId = updateData.invoiceId;
    if (updateData.paymentType)
      paymentVoucher.paymentType = updateData.paymentType;
    if (updateData.type) paymentVoucher.type = updateData.type;
    if (updateData.doneBy) paymentVoucher.doneBy = updateData.doneBy;

    // Update details if provided
    if (updateData.details) {
      const usdAccount = await this.accountRepository.findOne({
        where: { accountNumber: '5301' },
      });
      const llAccount = await this.accountRepository.findOne({
        where: { accountNumber: '5302' },
      });

      if (!usdAccount || !llAccount) {
        throw new NotFoundException('USD or LL account not found.');
      }

      const updatedDetails = updateData.details.flatMap((detail) => {
        const isUSD = detail.currency === 'USD';
        const amount = detail.amount;
        const exchangeRate = isUSD ? 1 : parseFloat(detail.exchangeRate || '1');
        const amountExchanged = isUSD ? amount : amount / exchangeRate;

        const debitDetail = this.paymentVoucherDetailRepository.create({
          dr: amountExchanged,
          drUSD: isUSD ? amount : amount / exchangeRate,
          drLL: isUSD ? 0 : amount,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          exchangeRate,
          checkNumber: detail.checkNumber || null,
          checkDate: detail.checkDate || null,
          checkDueDate: detail.checkDueDate || null,
          bankName: detail.bankName || null,
          description: detail.description || null,
          account: null,
        });

        const creditDetail = this.paymentVoucherDetailRepository.create({
          dr: 0,
          drUSD: 0,
          drLL: 0,
          cr: amountExchanged,
          crUSD: isUSD ? amount : amount / exchangeRate,
          crLL: isUSD ? 0 : amount,
          exchangeRate,
          account: isUSD ? usdAccount : llAccount,
          checkNumber: detail.checkNumber || null,
          checkDueDate: detail.checkDueDate || null,
          bankName: detail.bankName || null,
          checkDate: detail.checkDate || null,
          description: detail.description || null,
        });

        return [debitDetail, creditDetail];
      });

      // Replace old details
      await this.paymentVoucherDetailRepository.remove(paymentVoucher.details);
      paymentVoucher.details = updatedDetails;

      // Recalculate totals
      paymentVoucher.totalDr = updatedDetails.reduce(
        (sum, detail) => sum + detail.dr,
        0,
      );
      paymentVoucher.totalDrUSD = updatedDetails.reduce(
        (sum, detail) => sum + detail.drUSD,
        0,
      );
      paymentVoucher.totalDrLL = updatedDetails.reduce(
        (sum, detail) => sum + detail.drLL,
        0,
      );
      paymentVoucher.totalCr = updatedDetails.reduce(
        (sum, detail) => sum + detail.cr,
        0,
      );
      paymentVoucher.totalCrUSD = updatedDetails.reduce(
        (sum, detail) => sum + detail.crUSD,
        0,
      );
      paymentVoucher.totalCrLL = updatedDetails.reduce(
        (sum, detail) => sum + detail.crLL,
        0,
      );
    }

    return this.paymentVoucherRepository.save(paymentVoucher);
  }
}
