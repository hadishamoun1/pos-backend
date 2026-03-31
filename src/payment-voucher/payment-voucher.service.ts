import { Injectable, NotFoundException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { AccountingResolverService } from '../accountRoleMap/accounting-resolver.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentVoucher, PaymentType, VoucherType } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail, Currency } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Supplier } from '../entities/supplier.entity';
import { Account } from '../entities/account.entity';

/**
 * Cash account roles expected in AccountRoleMap:
 *
 *  role = "Cash_USD"  currencyCode = "USD"  → USD cash/bank account
 *  role = "Cash_LL"   currencyCode = "LL"   → LL cash/bank account
 *  role = "Check_USD" currencyCode = "USD"  → USD cheque account
 *  role = "Check_LL"  currencyCode = "LL"   → LL cheque account
 *
 * If separate Check accounts are not configured the resolver will fall back
 * to the null-currency default for that role, so Cash_USD can serve as the
 * fallback for Check USD if needed.
 */
@Injectable()
export class PaymentVoucherService {
  constructor(
    @InjectRepository(PaymentVoucher)
    private readonly paymentVoucherRepository: Repository<PaymentVoucher>,

    @InjectRepository(PaymentVoucherDetail)
    private readonly paymentVoucherDetailRepository: Repository<PaymentVoucherDetail>,

    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepository: Repository<JournalVoucher>,

    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepository: Repository<JournalVoucherDetail>,

    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,

    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,

    private readonly accountingResolver: AccountingResolverService,
    private readonly settingsService: SettingsService,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────────────────

  // For JournalVoucherDetail.checkDate which is type Date
  private dateOrNull(value: any): Date | null {
    if (!value || value === '') return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // For PaymentVoucherDetail.checkDate / checkDueDate which are type string
  private strDateOrNull(value: any): string | null {
    if (!value || value === '') return null;
    return value;
  }

  /**
   * Resolve the CR (cash/cheque) account from AccountRoleMap.
   *
   * Payment type → role + currency:
   *   Cash USD   → role: Cash_USD,  currency: USD
   *   Cash LL    → role: Cash_LL,   currency: LL
   *   Check USD  → role: Check_USD, currency: USD
   *   Check LL   → role: Check_LL,  currency: LL
   */
  private async getCashAccount(paymentType: string): Promise<Account> {
    const isUSD = paymentType.includes('USD');
    const isCash = paymentType.toLowerCase().includes('cash');

    const role = isCash
      ? isUSD ? 'Cash_USD' : 'Cash_LL'
      : isUSD ? 'Check_USD' : 'Check_LL';

    const currency = isUSD ? 'USD' : 'LL';

    return this.accountingResolver.resolveAccount(role, currency);
  }

  private async getNextPaymentNumber(type: VoucherType): Promise<string> {
    const activeYear = await this.settingsService.getActiveYear();
    const year = activeYear.slice(-2);
    const prefix = type === 'S' ? `PM${year}-` : `PMG${year}-`;

    const latest = await this.paymentVoucherRepository
      .createQueryBuilder('pv')
      .where('pv.type = :type', { type })
      .andWhere('pv.paymentNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('pv.paymentNumber', 'DESC')
      .take(1)
      .getOne();

    const next = latest?.paymentNumber
      ? parseInt(latest.paymentNumber.split('-')[1], 10) + 1
      : 1;

    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  /**
   * Builds one DR line (supplier) + one CR line (cash account) per detail.
   *
   * USD: dr = amount,        drUSD = amount,  drLL = 0
   * LL:  dr = amount/exRate, drUSD = dr,      drLL = amount
   */
  private buildJvLines(
    d: any,
    payee: { supplier?: Supplier; account?: Account },
    cashAccount: Account,
    type: VoucherType,
    paymentNumber: string,
  ): { drLine: JournalVoucherDetail; crLine: JournalVoucherDetail } {
    const isUSD = d.currency === 'USD';
    const amount = parseFloat(d.amount) || 0;
    const exchangeRate = parseFloat(d.exchangeRate) || 1;
    const amountExchanged = parseFloat(d.amountExchanged) || (isUSD ? amount * exchangeRate : amount / exchangeRate);

    // USD: drUSD = amount, drLL = amountExchanged (LL equivalent)
    // LL:  drLL  = amount, drUSD = amountExchanged (USD equivalent)
    const drUSD = isUSD ? amount : amountExchanged;
    const drLL  = isUSD ? amountExchanged : amount;
    const dr    = drUSD; // dr is always the USD equivalent

    const isS = type === 'S';

    // Type S → fill both regular and OFR fields
    // Type G → fill ONLY OFR fields, regular fields stay 0
    const drLine = this.journalVoucherDetailRepository.create({
      ...(payee.supplier
        ? { supplier: payee.supplier, supplierId: payee.supplier.id }
        : { account: payee.account, accountId: payee.account.id }),
      // Regular fields
      dr:    isS ? dr    : 0,
      drUSD: isS ? drUSD : 0,
      drLL:  isS ? drLL  : 0,
      cr:    0,
      crUSD: 0,
      crLL:  0,
      // OFR fields (always filled)
      drOFR:    dr,
      drUSDOFR: drUSD,
      drLLOFR:  drLL,
      crOFR:    0,
      crUSDOFR: 0,
      crLLOFR:  0,
      exRateUSD: exchangeRate,
      currency: d.currency,
      check: d.checkNumber || null,
      checkDate: this.dateOrNull(d.checkDate),
      bankName: d.bankName || null,
      description: d.description || null,
      docNbr: paymentNumber,
    });

    const crLine = this.journalVoucherDetailRepository.create({
      account: cashAccount,
      accountId: cashAccount.id,
      // Regular fields
      dr:    0,
      drUSD: 0,
      drLL:  0,
      cr:    isS ? dr    : 0,
      crUSD: isS ? drUSD : 0,
      crLL:  isS ? drLL  : 0,
      // OFR fields (always filled)
      drOFR:    0,
      drUSDOFR: 0,
      drLLOFR:  0,
      crOFR:    dr,
      crUSDOFR: drUSD,
      crLLOFR:  drLL,
      exRateUSD: exchangeRate,
      currency: d.currency,
      check: d.checkNumber || null,
      checkDate: this.dateOrNull(d.checkDate),
      bankName: d.bankName || null,
      description: d.description || null,
      docNbr: paymentNumber,
    });

    return { drLine, crLine };
  }

  private buildPmDetail(d: any): PaymentVoucherDetail {
    const exchangeRate = parseFloat(d.exchangeRate) || 1;
    const amount = parseFloat(d.amount) || 0;
    const isUSD = d.currency === 'USD';
    const amountExchanged = isUSD ? amount * exchangeRate : amount / exchangeRate;

    const detail = new PaymentVoucherDetail();
    detail.amount = amount;
    detail.currency = d.currency as Currency;
    detail.exchangeRate = exchangeRate;
    detail.amountExchanged = amountExchanged;
    detail.checkNumber = d.checkNumber || null;
    detail.checkDate = this.strDateOrNull(d.checkDate);
    detail.checkDueDate = this.strDateOrNull(d.checkDueDate);
    detail.bankName = d.bankName || null;
    detail.description = d.description || null;
    return detail;
  }

  private formatVoucher(voucher: PaymentVoucher): any {
    return {
      id: voucher.id,
      supplierId: voucher.supplierId,
      supplierName: voucher.supplier?.supplierName ?? null,
      accountId: voucher.accountId,
      accountName: voucher.account?.arabicAccountName ?? voucher.account?.accountName ?? null,
      date: voucher.date,
      invoiceId: voucher.invoiceId,
      paymentType: voucher.paymentType,
      type: voucher.type,
      doneBy: voucher.doneBy,
      paymentNumber: voucher.paymentNumber,
      dateCreated: voucher.dateCreated,
      dateModified: voucher.dateModified,
      details: (voucher.details ?? []).map((d) => ({
        amount: d.amount,
        currency: d.currency,
        exchangeRate: d.exchangeRate,
        amountExchanged: d.amountExchanged,
        checkNumber: d.checkNumber ?? null,
        checkDate: d.checkDate ?? null,
        checkDueDate: d.checkDueDate ?? null,
        bankName: d.bankName ?? null,
        description: d.description ?? null,
      })),
    };
  }

  // ── GET /v1/formatted ─────────────────────────────────────────────────────────

  async getFormatted(): Promise<any[]> {
    const vouchers = await this.paymentVoucherRepository.find({
      relations: ['supplier', 'account', 'details'],
    });
    return vouchers.map((v) => this.formatVoucher(v));
  }

  // ── GET /v1/filter ────────────────────────────────────────────────────────────

  async getFiltered(
    filters: {
      supplierId?: number;
      date?: string;
      paymentType?: string;
      paymentNumber?: string;
      amount?: number;
      type?: string;
    },
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const qb = this.paymentVoucherRepository
      .createQueryBuilder('voucher')
      .leftJoinAndSelect('voucher.supplier', 'supplier')
      .leftJoinAndSelect('voucher.account', 'account')
      .leftJoinAndSelect('voucher.details', 'detail');

    if (filters.supplierId)
      qb.andWhere('voucher.supplierId = :supplierId', { supplierId: filters.supplierId });
    if (filters.date)
      qb.andWhere('DATE(voucher.date) = :date', { date: filters.date });
    if (filters.paymentType)
      qb.andWhere('voucher.paymentType = :paymentType', { paymentType: filters.paymentType });
    if (filters.paymentNumber)
      qb.andWhere('voucher.paymentNumber LIKE :paymentNumber', { paymentNumber: `%${filters.paymentNumber}%` });
    if (filters.amount)
      qb.andWhere('detail.amount = :amount', { amount: filters.amount });
    if (filters.type)
      qb.andWhere('voucher.type = :type', { type: filters.type });

    const total = await qb.getCount();
    const data = await qb.skip((page - 1) * limit).take(limit).getMany();

    return { data: data.map((v) => this.formatVoucher(v)), total, page, limit };
  }

  // ── POST /v1/bulk ─────────────────────────────────────────────────────────────

  async createBulk(
    transactions: {
      supplierId?: number;
      accountId?: number;
      date: string;
      invoiceId: string;
      paymentType: PaymentType;
      type: VoucherType;
      doneBy: string;
      details: any[];
    }[],
  ): Promise<PaymentVoucher[]> {
    const results: PaymentVoucher[] = [];

    for (const tx of transactions) {
      let supplier: Supplier | null = null;
      let payeeAccount: Account | null = null;

      if (tx.supplierId) {
        supplier = await this.supplierRepository.findOne({ where: { id: tx.supplierId } });
        if (!supplier)
          throw new NotFoundException(`Supplier with ID ${tx.supplierId} not found.`);
      } else if (tx.accountId) {
        payeeAccount = await this.accountRepository.findOne({ where: { id: tx.accountId } });
        if (!payeeAccount)
          throw new NotFoundException(`Account with ID ${tx.accountId} not found.`);
      } else {
        throw new NotFoundException('Either supplierId or accountId must be provided.');
      }

      const payee = supplier ? { supplier } : { account: payeeAccount };

      const cashAccount = await this.getCashAccount(tx.paymentType);
      const paymentNumber = await this.getNextPaymentNumber(tx.type);
      const jvNumber = paymentNumber;

      let totalDr = 0, totalDrUSD = 0, totalDrLL = 0;
      let totalCr = 0, totalCrUSD = 0, totalCrLL = 0;
      let totalDrOFR = 0, totalDrUSDOFR = 0, totalDrLLOFR = 0;
      let totalCrOFR = 0, totalCrUSDOFR = 0, totalCrLLOFR = 0;
      const jvDetails: JournalVoucherDetail[] = [];

      for (const d of tx.details) {
        const { drLine, crLine } = this.buildJvLines(d, payee, cashAccount, tx.type, paymentNumber);
        totalDr       += Number(drLine.dr);
        totalDrUSD    += Number(drLine.drUSD);
        totalDrLL     += Number(drLine.drLL);
        totalDrOFR    += Number(drLine.drOFR);
        totalDrUSDOFR += Number(drLine.drUSDOFR);
        totalDrLLOFR  += Number(drLine.drLLOFR);
        totalCr       += Number(crLine.cr);
        totalCrUSD    += Number(crLine.crUSD);
        totalCrLL     += Number(crLine.crLL);
        totalCrOFR    += Number(crLine.crOFR);
        totalCrUSDOFR += Number(crLine.crUSDOFR);
        totalCrLLOFR  += Number(crLine.crLLOFR);
        jvDetails.push(drLine, crLine);
      }

      const jv = await this.journalVoucherRepository.save(
        this.journalVoucherRepository.create({
          date: tx.date,
          jvNumber,
          jvType: tx.type,
          totalDr,
          totalDrUSD,
          totalDrLL,
          totalDrOFR,
          totalDrUSDOFR,
          totalDrLLOFR,
          totalCr,
          totalCrUSD,
          totalCrLL,
          totalCrOFR,
          totalCrUSDOFR,
          totalCrLLOFR,
          details: jvDetails,
        }),
      );

      const voucher = this.paymentVoucherRepository.create({
        ...(supplier
          ? { supplier, supplierId: supplier.id }
          : { account: payeeAccount, accountId: payeeAccount.id }),
        date: tx.date,
        paymentNumber,
        invoiceId: tx.invoiceId,
        paymentType: tx.paymentType,
        type: tx.type,
        doneBy: tx.doneBy,
        journalVoucher: jv,
        details: tx.details.map((d) => this.buildPmDetail(d)),
      });

      const savedVoucher = await this.paymentVoucherRepository.save(voucher);

      // Write paymentVoucherId back onto the JV row
      await this.journalVoucherRepository.update(jv.id, {
        paymentVoucherId: savedVoucher.id,
      });

      results.push(savedVoucher);
    }

    return results;
  }

  // ── PATCH /:id ────────────────────────────────────────────────────────────────

  async update(
    id: number,
    updateData: {
      supplierId?: number;
      accountId?: number;
      date?: string;
      invoiceId?: string;
      paymentType?: PaymentType;
      type?: VoucherType;
      doneBy?: string;
      details?: any[];
    },
  ): Promise<PaymentVoucher> {
    const voucher = await this.paymentVoucherRepository.findOne({
      where: { id },
      relations: ['supplier', 'account', 'details', 'journalVoucher', 'journalVoucher.details'],
    });
    if (!voucher)
      throw new NotFoundException(`Payment voucher with ID ${id} not found.`);

    if (updateData.supplierId) {
      const supplier = await this.supplierRepository.findOne({ where: { id: updateData.supplierId } });
      if (!supplier)
        throw new NotFoundException(`Supplier with ID ${updateData.supplierId} not found.`);
      voucher.supplier = supplier;
      voucher.supplierId = supplier.id;
      voucher.account = null;
      voucher.accountId = null;
    } else if (updateData.accountId) {
      const account = await this.accountRepository.findOne({ where: { id: updateData.accountId } });
      if (!account)
        throw new NotFoundException(`Account with ID ${updateData.accountId} not found.`);
      voucher.account = account;
      voucher.accountId = account.id;
      voucher.supplier = null;
      voucher.supplierId = null;
    }

    if (updateData.date) voucher.date = updateData.date;
    if (updateData.invoiceId) voucher.invoiceId = updateData.invoiceId;
    if (updateData.paymentType) voucher.paymentType = updateData.paymentType;
    if (updateData.type) voucher.type = updateData.type;
    if (updateData.doneBy) voucher.doneBy = updateData.doneBy;

    if (updateData.details) {
      const paymentType = updateData.paymentType || voucher.paymentType;
      const cashAccount = await this.getCashAccount(paymentType);
      const payee = voucher.supplier
        ? { supplier: voucher.supplier }
        : { account: voucher.account };

      await this.paymentVoucherDetailRepository.remove(voucher.details);
      voucher.details = updateData.details.map((d) => this.buildPmDetail(d));

      let totalDr = 0, totalDrUSD = 0, totalDrLL = 0;
      let totalCr = 0, totalCrUSD = 0, totalCrLL = 0;
      let totalDrOFR = 0, totalDrUSDOFR = 0, totalDrLLOFR = 0;
      let totalCrOFR = 0, totalCrUSDOFR = 0, totalCrLLOFR = 0;
      const jvDetails: JournalVoucherDetail[] = [];

      for (const d of updateData.details) {
        const { drLine, crLine } = this.buildJvLines(d, payee, cashAccount, (updateData.type || voucher.type) as VoucherType, voucher.paymentNumber);
        totalDr       += Number(drLine.dr);
        totalDrUSD    += Number(drLine.drUSD);
        totalDrLL     += Number(drLine.drLL);
        totalDrOFR    += Number(drLine.drOFR);
        totalDrUSDOFR += Number(drLine.drUSDOFR);
        totalDrLLOFR  += Number(drLine.drLLOFR);
        totalCr       += Number(crLine.cr);
        totalCrUSD    += Number(crLine.crUSD);
        totalCrLL     += Number(crLine.crLL);
        totalCrOFR    += Number(crLine.crOFR);
        totalCrUSDOFR += Number(crLine.crUSDOFR);
        totalCrLLOFR  += Number(crLine.crLLOFR);
        jvDetails.push(drLine, crLine);
      }

      const jv = voucher.journalVoucher;
      await this.journalVoucherDetailRepository.remove(jv.details);
      Object.assign(jv, {
        details: jvDetails,
        totalDr, totalDrUSD, totalDrLL,
        totalDrOFR, totalDrUSDOFR, totalDrLLOFR,
        totalCr, totalCrUSD, totalCrLL,
        totalCrOFR, totalCrUSDOFR, totalCrLLOFR,
      });
      await this.journalVoucherRepository.save(jv);
    }

    return this.paymentVoucherRepository.save(voucher);
  }

  // ── DELETE /:id ───────────────────────────────────────────────────────────────

async remove(id: number): Promise<void> {
  await this.paymentVoucherRepository.manager.transaction(async (manager) => {
    const voucher = await manager.findOne(PaymentVoucher, {
      where: { id },
      relations: ['details', 'journalVoucher', 'journalVoucher.details'],
    });

    if (!voucher) {
      throw new NotFoundException(`Payment voucher with ID ${id} not found.`);
    }

    const jv =
      voucher.journalVoucher ||
      (await manager.findOne(JournalVoucher, {
        where: { paymentVoucherId: id },
        relations: ['details'],
      }));

    if (jv) {
      // 1) Break payment_vouchers.journalVoucherId -> journal_vouchers.id
      await manager
        .createQueryBuilder()
        .update(PaymentVoucher)
        .set({ journalVoucher: null as any })
        .where('id = :id', { id: voucher.id })
        .execute();

      // 2) Break journal_vouchers.paymentVoucherId -> payment_vouchers.id
      await manager
        .createQueryBuilder()
        .update(JournalVoucher)
        .set({ paymentVoucherId: null })
        .where('id = :id', { id: jv.id })
        .execute();

      // 3) Delete JV details
      if (jv.details?.length) {
        await manager.remove(JournalVoucherDetail, jv.details);
      }

      // 4) Delete JV
      await manager.delete(JournalVoucher, jv.id);
    }

    // 5) Delete payment voucher details
    if (voucher.details?.length) {
      await manager.remove(PaymentVoucherDetail, voucher.details);
    }

    // 6) Delete payment voucher
    await manager.delete(PaymentVoucher, voucher.id);
  });
}
}