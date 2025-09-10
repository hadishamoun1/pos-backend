import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class JournalVoucherService {
  constructor(
    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepository: Repository<JournalVoucher>,
    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepository: Repository<JournalVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createJournalVoucher(data: {
    date: Date;
    jvType: string;
    details: {
      accountId: number; // Each entry specifies its own accountId
      description?: string | null;
      debit: string;
      debitUSD: string;
      debitLL: string;
      credit: string;
      creditUSD: string;
      creditLL: string;
      currency: string;
      exchangeRateEURtoUSD: string;
      exchangeRate: string;
      docNbr?: string | null;
    }[];
  }): Promise<JournalVoucher> {
    const { date, jvType, details } = data;

    // Validate jvType
    if (!jvType || !['S', 'G'].includes(jvType)) {
      throw new BadRequestException('Invalid JV type. Must be "S" or "G".');
    }

    // Validate details
    if (!details || details.length === 0) {
      throw new BadRequestException('Voucher must have at least one detail.');
    }

    // Generate JV Number
    const prefix = jvType === 'S' ? 'JV' : 'JVG';
    const lastVoucher = await this.journalVoucherRepository.find({
      where: { jvNumber: Like(`${prefix} - %`) },
      order: { jvNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].jvNumber.split(' - ')[1], 10) + 1
        : 1;
    const jvNumber = `${prefix} - ${String(nextNumber).padStart(5, '0')}`;

    // Prepare details
    const resolvedDetails = details.map((detail) => {
      return this.journalVoucherDetailRepository.create({
        accountId: detail.accountId, // Use entry-specific accountId
        description: detail.description || null,
        dr: parseFloat(detail.debit),
        drUSD: parseFloat(detail.debitUSD),
        drLL: parseFloat(detail.debitLL),
        cr: parseFloat(detail.credit),
        crUSD: parseFloat(detail.creditUSD),
        crLL: parseFloat(detail.creditLL),
        currency: detail.currency,
        exRateEUROToUSD: parseFloat(detail.exchangeRateEURtoUSD) || 0,
        exRateUSD: parseFloat(detail.exchangeRate),
        docNbr: detail.docNbr || null,
      });
    });

    // Calculate totals
    const totalDr = resolvedDetails.reduce((sum, d) => sum + d.dr, 0);
    const totalDrUSD = resolvedDetails.reduce((sum, d) => sum + d.drUSD, 0);
    const totalDrLL = resolvedDetails.reduce((sum, d) => sum + d.drLL, 0);
    const totalCr = resolvedDetails.reduce((sum, d) => sum + d.cr, 0);
    const totalCrUSD = resolvedDetails.reduce((sum, d) => sum + d.crUSD, 0);
    const totalCrLL = resolvedDetails.reduce((sum, d) => sum + d.crLL, 0);

    // Create the JournalVoucher entity
    const journalVoucher = this.journalVoucherRepository.create({
      date,
      jvType,
      jvNumber,
      totalDr,
      totalDrUSD,
      totalDrLL,
      totalCr,
      totalCrUSD,
      totalCrLL,
      details: resolvedDetails,
    });

    // Save the journal voucher
    return this.journalVoucherRepository.save(journalVoucher);
  }

  async getAllJournalVouchers(): Promise<JournalVoucher[]> {
    return this.journalVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getJournalVoucherById(id: number): Promise<JournalVoucher> {
    const journalVoucher = await this.journalVoucherRepository.findOne({
      where: { id },
      relations: [
        'details', // Include details
        'details.account', // Include the related account for each detail
        'details.customer',
        'details.supplier',
      ],
    });

    if (!journalVoucher) {
      throw new NotFoundException(`Journal Voucher with ID ${id} not found.`);
    }

    // Map through the details to add accountNumber and accountName
    journalVoucher.details = journalVoucher.details.map((detail) => ({
      ...detail,
      accountNumber: detail.account?.accountNumber || null,
      accountName:
        detail.account?.accountName ||
        detail.supplier?.supplierName ||
        detail.customer?.customerName ||
        null,
    }));

    return journalVoucher;
  }

  async updateJournalVoucher(
    id: number,
    data: Partial<JournalVoucher>,
  ): Promise<JournalVoucher> {
    const journalVoucher = await this.getJournalVoucherById(id);
    Object.assign(journalVoucher, data);
    return this.journalVoucherRepository.save(journalVoucher);
  }

  async deleteJournalVoucher(id: number): Promise<void> {
    const journalVoucher = await this.getJournalVoucherById(id);
    await this.journalVoucherRepository.remove(journalVoucher);
  }

  async getVoucherSummary(): Promise<
    { date: Date; jvNumber: string; jvType: string; description: string }[]
  > {
    const vouchers = await this.journalVoucherRepository.find({
      relations: ['details'],
    });

    return vouchers.map((voucher) => {
      const debitDetail = voucher.details.find((detail) => detail.dr > 0);
      return {
        id: voucher.id,
        date: voucher.date,
        jvNumber: voucher.jvNumber,
        jvType: voucher.jvType,
        description: debitDetail ? debitDetail.description : 'No Description',
      };
    });
  }

  async getCustomerStatementOFR(params: {
  customerId: number;
  currency?: 'USD' | 'LL' | 'EURO' | 'BASE';
  from?: string; // 'YYYY-MM-DD'
  to?: string;   // 'YYYY-MM-DD'
}) {
  const { customerId, currency = 'USD', from, to } = params;

  // OFR column mapping
  const colMap = {
    USD:  { dr: 'drUSDOFR',  cr: 'crUSDOFR'  },
    LL:   { dr: 'drLLOFR',   cr: 'crLLOFR'   },
    EURO: { dr: 'drOFR',     cr: 'crOFR'     }, // no dedicated EURO OFR columns; use base OFR
    BASE: { dr: 'drOFR',     cr: 'crOFR'     },
  } as const;

  const pair = colMap[currency] ?? colMap.USD;
  const drCol = pair.dr as keyof JournalVoucherDetail;
  const crCol = pair.cr as keyof JournalVoucherDetail;

  // Query rows for period
  const qb = this.journalVoucherDetailRepository
    .createQueryBuilder('d')
    .leftJoinAndSelect('d.journalVoucher', 'jv')
    .leftJoinAndSelect('d.customer', 'c')
    .where('d.customerId = :customerId', { customerId });

  if (from) qb.andWhere('jv.date >= :from', { from });
  if (to)   qb.andWhere('jv.date <= :to',   { to });

  qb.orderBy('jv.date', 'ASC').addOrderBy('d.id', 'ASC');

  const rows = await qb.getMany();

  // Opening balance before "from" (OFR columns only)
  let openingBalance = 0;
  if (from) {
    const beforeRows = await this.journalVoucherDetailRepository
      .createQueryBuilder('d')
      .leftJoin('d.journalVoucher', 'jv')
      .where('d.customerId = :customerId', { customerId })
      .andWhere('jv.date < :from', { from })
      .getMany();

    const openingDr = beforeRows.reduce((s, r) => s + Number(r[drCol] || 0), 0);
    const openingCr = beforeRows.reduce((s, r) => s + Number(r[crCol] || 0), 0);
    openingBalance = openingDr - openingCr;
  }

  // Build items + running balance; include exchange rate fields conditionally
  let running = openingBalance;

  const items = rows.map((r) => {
    const debit  = Number(r[drCol] || 0);
    const credit = Number(r[crCol] || 0);
    running += debit - credit;

    return {
      journalVoucherId: r.journalVoucherId,
      date: r.journalVoucher?.date,
      jvNumber: r.journalVoucher?.jvNumber,
      description: r.description ?? null,
      debit,
      credit,
      balanceAfter: running,
      // Include the relevant exchange rate fields for the selected currency
      exRateUSD: currency === 'LL' ? Number(r.exRateUSD || 0) : undefined,
      exRateEUROToUSD: currency === 'EURO' ? Number(r.exRateEUROToUSD || 0) : undefined,
    };
  });

  const totals = items.reduce(
    (acc, li) => {
      acc.totalDebit  += li.debit;
      acc.totalCredit += li.credit;
      return acc;
    },
    { totalDebit: 0, totalCredit: 0 }
  );

  return {
    customerId,
    currency,
    basis: { debitColumn: drCol, creditColumn: crCol }, // which OFR pair was used
    from: from ?? null,
    to: to ?? null,
    openingBalance,
    totals,
    closingBalance: running,
    items,
  };
}

}
