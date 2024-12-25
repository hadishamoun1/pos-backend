import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ReceiptVoucher } from '../entities/Vouchers/recieptVoucher.entity';
import { ReceiptVoucherDetail } from '../entities/Vouchers/recieptVoucherDetails.entity';
import { Customer } from '../entities/customer.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { Account } from 'src/entities/account.entity';

@Injectable()
export class ReceiptVoucherService {
  constructor(
    @InjectRepository(ReceiptVoucher)
    private readonly receiptVoucherRepository: Repository<ReceiptVoucher>,
    @InjectRepository(ReceiptVoucherDetail)
    private readonly receiptVoucherDetailRepository: Repository<ReceiptVoucherDetail>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}
  async createReceiptVoucher(data: {
    customerAccountId: number;
    date: Date;
    details: {
      cashNumber: string;
      currency: string; // "USD" or "LL"
      exchangeRate?: string; // Only required if currency is "LL"
    }[];
  }): Promise<ReceiptVoucher> {
    const { customerAccountId, date, details } = data;

    // Validate the customer account
    const customer = await this.customerRepository.findOne({
      where: { id: customerAccountId },
    });
    if (!customer) {
      throw new NotFoundException(
        `Customer with ID ${customerAccountId} not found.`,
      );
    }

    // Fetch account details for 5301 (USD) and 5302 (LL)
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

    // Generate the next RV number
    const lastVoucher = await this.receiptVoucherRepository.find({
      where: { rvNumber: Like('RV - %') },
      order: { rvNumber: 'DESC' },
      take: 1,
    });
    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].rvNumber.split(' - ')[1], 10) + 1
        : 1;
    const rvNumber = `RV - ${String(nextNumber).padStart(3, '0')}`;

    // Generate Receipt Voucher Details
    const voucherDetails = details.flatMap((detail) => {
      const isUSD = detail.currency === 'USD';
      const cashNumber = parseFloat(detail.cashNumber);
      const exchangeRate = isUSD
        ? 1 // Exchange rate for USD to USD
        : parseFloat(detail.exchangeRate || '1'); // Use exchange rate if LL

      // Compute values based on currency
      const dr = isUSD ? cashNumber : cashNumber / exchangeRate;
      const drUSD = dr;
      const drLL = isUSD ? null : cashNumber;

      const cr = dr; // For simplicity, debit and credit amounts are the same
      const crUSD = drUSD;
      const crLL = drLL;

      // Create debit and credit entries
      const debitDetail = this.receiptVoucherDetailRepository.create({
        dr,
        drUSD,
        drLL,
        cr: 0,
        crUSD: 0,
        crLL: 0,
        account: isUSD ? usdAccount : llAccount,
      });

      const creditDetail = this.receiptVoucherDetailRepository.create({
        dr: 0,
        drUSD: 0,
        drLL: 0,
        cr,
        crUSD,
        crLL,
        account: isUSD ? llAccount : usdAccount,
      });

      return [debitDetail, creditDetail];
    });

    // Create the Receipt Voucher
    const receiptVoucher = this.receiptVoucherRepository.create({
      customer,
      date,
      rvNumber,
      details: voucherDetails,
    });

    return this.receiptVoucherRepository.save(receiptVoucher);
  }

  // Get all Receipt Vouchers
  async getAllReceiptVouchers(): Promise<ReceiptVoucher[]> {
    return this.receiptVoucherRepository.find({
      relations: ['customer', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  // Get a single Receipt Voucher by ID
  async getReceiptVoucherById(id: number): Promise<ReceiptVoucher> {
    const receiptVoucher = await this.receiptVoucherRepository.findOne({
      where: { id },
      relations: ['customer', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!receiptVoucher) {
      throw new NotFoundException(`Receipt Voucher with ID ${id} not found.`);
    }
    return receiptVoucher;
  }

  // Update a Receipt Voucher
  async updateReceiptVoucher(
    id: number,
    data: Partial<ReceiptVoucher> & { customerAccountId?: number },
  ): Promise<ReceiptVoucher> {
    const receiptVoucher = await this.getReceiptVoucherById(id);

    if (data.customerAccountId) {
      const customer = await this.customerRepository.findOne({
        where: { id: data.customerAccountId },
      });
      if (!customer) {
        throw new NotFoundException(
          `Customer with ID ${data.customerAccountId} not found.`,
        );
      }
      receiptVoucher.customer = customer;
    }

    Object.assign(receiptVoucher, data);
    return this.receiptVoucherRepository.save(receiptVoucher);
  }

  // Delete a Receipt Voucher
  async deleteReceiptVoucher(id: number): Promise<void> {
    const receiptVoucher = await this.getReceiptVoucherById(id);
    await this.receiptVoucherRepository.remove(receiptVoucher);
  }

  async createMultipleReceiptVouchers(
    transactions: {
      customerAccountId: number;
      date: Date;
      invoiceId: string; // New field for invoice ID
      details: {
        cashNumber: string;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required if currency is "LL"
        comments?: string; // Optional comments
      }[];
    }[],
  ): Promise<ReceiptVoucher[]> {
    const receiptVouchers: ReceiptVoucher[] = [];

    for (const transaction of transactions) {
      const { customerAccountId, date, invoiceId, details } = transaction;

      // Validate the customer account
      const customer = await this.customerRepository.findOne({
        where: { id: customerAccountId },
      });
      if (!customer) {
        throw new NotFoundException(
          `Customer with ID ${customerAccountId} not found.`,
        );
      }

      // Fetch account details for 5301 (USD) and 5302 (LL)
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
      const rvNumber = `RV - ${String(nextNumber).padStart(3, '0')}`;

      // Generate Receipt Voucher Details
      const voucherDetails = details.flatMap((detail) => {
        const isUSD = detail.currency === 'USD';
        const cashNumber = parseFloat(detail.cashNumber);
        const exchangeRate = isUSD ? 1 : parseFloat(detail.exchangeRate || '1');

        const dr = isUSD ? cashNumber : cashNumber / exchangeRate;
        const drUSD = isUSD ? cashNumber : cashNumber / exchangeRate;
        const drLL = isUSD ? null : cashNumber;

        const cr = dr;
        const crUSD = drUSD;
        const crLL = drLL;

        const account = isUSD ? usdAccount : llAccount;

        const debitDetail = this.receiptVoucherDetailRepository.create({
          dr,
          drUSD,
          drLL,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          account,
          comments: detail.comments || null,
        });

        const creditDetail = this.receiptVoucherDetailRepository.create({
          dr: 0,
          drUSD: 0,
          drLL: 0,
          cr,
          crUSD,
          crLL,
          account,
          comments: detail.comments || null,
        });

        return [debitDetail, creditDetail];
      });

      const receiptVoucher = this.receiptVoucherRepository.create({
        customer,
        date,
        rvNumber,
        invoiceId, // Set invoice ID
        details: voucherDetails,
      });

      receiptVouchers.push(
        await this.receiptVoucherRepository.save(receiptVoucher),
      );
    }

    return receiptVouchers;
  }
}
