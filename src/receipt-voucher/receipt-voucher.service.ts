import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ReceiptVoucher } from '../entities/Vouchers/recieptVoucher.entity';
import { ReceiptVoucherDetail } from '../entities/Vouchers/recieptVoucherDetails.entity';
import { Customer } from '../entities/customer.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { Account } from 'src/entities/account.entity';
import { ReceiptVoucherGateway } from './receipt-voucher-gateway.broadcast';
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
    private readonly gateway: ReceiptVoucherGateway,
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

    // Fetch updated data and broadcast to WebSocket clients
    const updatedData = await this.getSpecificFields();
    this.gateway.broadcastReceiptVouchers(updatedData);

    return this.receiptVoucherRepository.save(receiptVoucher);
  }
  // Get all Receipt Vouchers
  async getAllReceiptVouchers(): Promise<ReceiptVoucher[]> {
    return this.receiptVoucherRepository.find({
      relations: ['customer', 'details', 'details.account'], // Include only required relations
    });
  }

  // Get a single Receipt Voucher by ID
  async getReceiptVoucherById(id: number): Promise<ReceiptVoucher> {
    const receiptVoucher = await this.receiptVoucherRepository.findOne({
      where: { id },
      relations: ['customer', 'details', 'details.account'], // Include only required relations
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

    // Fetch updated data and broadcast to WebSocket clients
    const updatedData = await this.getSpecificFields();
    this.gateway.broadcastReceiptVouchers(updatedData);

    Object.assign(receiptVoucher, data);
    return this.receiptVoucherRepository.save(receiptVoucher);
  }

  // Delete a Receipt Voucher
  async deleteReceiptVoucher(id: number): Promise<void> {
    // Find the receipt voucher by ID with its details to ensure cascading deletion
    const receiptVoucher = await this.receiptVoucherRepository.findOne({
      where: { id },
      relations: ['customer', 'details', 'details.account'], // Include necessary relations
    });

    if (!receiptVoucher) {
      throw new NotFoundException(`Receipt Voucher with ID ${id} not found.`);
    }

    // Remove the receipt voucher and cascade the delete to details
    await this.receiptVoucherRepository.remove(receiptVoucher);

    // Fetch updated data and broadcast to WebSocket clients
    const updatedData = await this.getSpecificFields();
    this.gateway.broadcastReceiptVouchers(updatedData);
  }

  async createMultipleReceiptVouchers(
    transactions: {
      customerAccountId: number;
      date: Date;
      invoiceId: string;
      details: {
        cashNumber: string;
        currency: string; // "USD" or "LL"
        exchangeRate?: string; // Only required for "LL"
        amountExchanged?: string; // Added explicitly for LL
        comments?: string; // Optional comments
      }[];
    }[],
  ): Promise<ReceiptVoucher[]> {
    const receiptVouchers: ReceiptVoucher[] = [];

    let lastVoucher = await this.receiptVoucherRepository.find({
      where: { rvNumber: Like('RV - %') },
      order: { rvNumber: 'DESC' },
      take: 1,
    });

    let nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].rvNumber.split(' - ')[1], 10) + 1
        : 1;

    for (const transaction of transactions) {
      const { customerAccountId, date, invoiceId, details } = transaction;

      const customer = await this.customerRepository.findOne({
        where: { id: customerAccountId },
      });
      if (!customer)
        throw new NotFoundException(
          `Customer with ID ${customerAccountId} not found.`,
        );

      const usdAccount = await this.accountRepository.findOne({
        where: { accountNumber: '5301' },
      });
      if (!usdAccount)
        throw new NotFoundException(`Account with number 5301 not found.`);

      const llAccount = await this.accountRepository.findOne({
        where: { accountNumber: '5302' },
      });
      if (!llAccount)
        throw new NotFoundException(`Account with number 5302 not found.`);

      const rvNumber = `RV - ${String(nextNumber++).padStart(3, '0')}`;

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

        // Adjusted Logic
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

        // User input (credit) transaction
        const creditDetail = this.receiptVoucherDetailRepository.create({
          dr: 0,
          drUSD: 0,
          drLL: 0,
          cr,
          crUSD,
          crLL,
          account: null, // User input has no account ID
          exchangeRate,
          comments: detail.comments || null, // Set comments from user input
        });

        // Auto-generated (debit) transaction
        const debitDetail = this.receiptVoucherDetailRepository.create({
          dr,
          drUSD,
          drLL,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          account: isUSD ? usdAccount : llAccount,
          exchangeRate,
          comments: detail.comments || null, // Copy comments from user input
        });

        return [creditDetail, debitDetail];
      });

      const receiptVoucher = this.receiptVoucherRepository.create({
        customer,
        date,
        rvNumber,
        invoiceId,
        details: voucherDetails,
        totalDr,
        totalDrUSD,
        totalDrLL,
        totalCr,
        totalCrUSD,
        totalCrLL,
      });

      receiptVouchers.push(
        await this.receiptVoucherRepository.save(receiptVoucher),
      );

      // Fetch updated data and broadcast to WebSocket clients
      const updatedData = await this.getSpecificFields();
      console.log('Broadcasting updated data:', updatedData);
      this.gateway.broadcastReceiptVouchers(updatedData);
    }

    return receiptVouchers;
  }
  async getSpecificFields() {
    const vouchers = await this.receiptVoucherRepository.find({
      relations: ['customer', 'details'],
    });

    return vouchers.map((voucher) => {
      const {
        date,
        rvNumber,
        invoiceId,
        totalCr,
        totalCrLL,
        customer,
        details,
      } = voucher;

      // Filter to include only credit transactions (exclude autogenerated debit transactions)
      const creditDetails = details.filter(
        (detail) => Number(detail.cr) > 0 && Number(detail.dr) === 0,
      );

      return {
        date,
        rvNumber,
        invoiceId,
        totalCr,
        totalCrLL,
        customer: {
          id: customer.id,
          name: customer.customerName,
        },
        comments: creditDetails
          .map((detail) => detail.comments)
          .filter((comment) => comment), // Only non-null comments
        exchangeRate: creditDetails
          .map((detail) => detail.exchangeRate)
          .filter((rate) => rate), // Only valid exchange rates
      };
    });
  }
}
