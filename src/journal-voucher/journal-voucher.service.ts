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
import { Customer } from 'src/entities/customer.entity';

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
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

 async createJournalVoucher(data: {
  date: Date;
  jvType: string; // 'S' | 'G' | 'SR'
  details: {
    // Exactly one of these three must be provided:
    accountId?: number;
    customerId?: number;
    supplierId?: number;

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

  // 1) Validate JV type (UI uses S, G, SR)
  if (!jvType || !['S', 'G', 'SR'].includes(jvType)) {
    throw new BadRequestException('Invalid JV type. Must be "S", "G", or "SR".');
  }

  // 2) Validate details exist
  if (!details || details.length === 0) {
    throw new BadRequestException('Voucher must have at least one detail.');
  }

  // 3) Generate JV number
  const prefix = jvType === 'G' ? 'JVG' : 'JV';
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

  // helper to parse numbers safely (handles "", null, commas)
  const toN = (v: any) => {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  // 4) Map input rows → entity rows with correct target column
  const resolvedDetails = details.map((detail, idx) => {
    const setFlags = [
      detail.accountId ? 1 : 0,
      detail.customerId ? 1 : 0,
      detail.supplierId ? 1 : 0,
    ];
    const howManyTargets = setFlags.reduce((a, b) => a + b, 0);

    if (howManyTargets !== 1) {
      throw new BadRequestException(
        `Each detail must provide exactly one of accountId/customerId/supplierId (row ${idx + 1}).`
      );
    }

    // Build base payload
    const basePayload: Partial<JournalVoucherDetail> = {
      description: detail.description ?? null,
      dr: toN(detail.debit),
      drUSD: toN(detail.debitUSD),
      drLL: toN(detail.debitLL),
      cr: toN(detail.credit),
      crUSD: toN(detail.creditUSD),
      crLL: toN(detail.creditLL),
      currency: detail.currency,
      exRateEUROToUSD: toN(detail.exchangeRateEURtoUSD),
      exRateUSD: toN(detail.exchangeRate),
      docNbr: detail.docNbr ?? null,
    };

    // Attach the correct foreign key column (exactly one)
    if (detail.accountId) {
      (basePayload as any).accountId = detail.accountId;
    } else if (detail.customerId) {
      (basePayload as any).customerId = detail.customerId;
    } else if (detail.supplierId) {
      (basePayload as any).supplierId = detail.supplierId;
    }

    return this.journalVoucherDetailRepository.create(basePayload);
  });

  // 5) Totals (base-only here; add OFR if your schema requires it)
  const totalDr = resolvedDetails.reduce((sum, d) => sum + toN(d.dr), 0);
  const totalDrUSD = resolvedDetails.reduce((sum, d) => sum + toN(d.drUSD), 0);
  const totalDrLL = resolvedDetails.reduce((sum, d) => sum + toN(d.drLL), 0);
  const totalCr = resolvedDetails.reduce((sum, d) => sum + toN(d.cr), 0);
  const totalCrUSD = resolvedDetails.reduce((sum, d) => sum + toN(d.crUSD), 0);
  const totalCrLL = resolvedDetails.reduce((sum, d) => sum + toN(d.crLL), 0);

  // 6) Create header
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

  // 7) Save
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
  type?: 'S' | 'G' | 'ALL';
  from?: string; // 'YYYY-MM-DD'
  to?: string;   // 'YYYY-MM-DD'
}) {
  const { customerId, type = 'ALL', from, to } = params;

  // 1) Load customer & infer currency
  const customer = await this.customerRepo.findOne({
    where: { id: customerId },
    relations: ['currency'],
  });
  if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

  let currencyCode =
    (customer as any)?.currency?.code as 'USD' | 'LL' | 'EURO' | 'BASE' | undefined;
  if (!currencyCode) {
    // fallback mapping if you don't store a code
    currencyCode = customer.currencyId === 2 ? 'LL' : 'USD';
  }

  // 2) Column maps
  // OFR columns (used for G rows)
  const ofrColMap = {
    USD:  { dr: 'drUSDOFR',  cr: 'crUSDOFR'  },
    LL:   { dr: 'drLLOFR',   cr: 'crLLOFR'   },
    EURO: { dr: 'drOFR',     cr: 'crOFR'     },
    BASE: { dr: 'drOFR',     cr: 'crOFR'     },
  } as const;

  // Non-OFR columns (used for S & other rows)
  const baseColMap = {
    USD:  { dr: 'drUSD',  cr: 'crUSD'  },
    LL:   { dr: 'drLL',   cr: 'crLL'   },
    EURO: { dr: 'dr',     cr: 'cr'     },
    BASE: { dr: 'dr',     cr: 'cr'     },
  } as const;

  type RowKind = 'S' | 'G';

  const getColsFor = (rowKind: RowKind) => {
    if (rowKind === 'G') {
      const p = ofrColMap[currencyCode] ?? ofrColMap.USD;
      return { drCol: p.dr as keyof JournalVoucherDetail, crCol: p.cr as keyof JournalVoucherDetail };
    }
    // 'S' = non-OFR
    const p = baseColMap[currencyCode] ?? baseColMap.USD;
    return { drCol: p.dr as keyof JournalVoucherDetail, crCol: p.cr as keyof JournalVoucherDetail };
  };

  // 3) Type filter — use JV.jvType primarily; docNbr is a fallback
  const applyTypeFilter = (
    qb: ReturnType<typeof this.journalVoucherDetailRepository.createQueryBuilder>
  ) => {
    if (type === 'S') {
      qb.andWhere('(jv.jvType = :tS OR d.docNbr LIKE :sPrefix)', { tS: 'S', sPrefix: 'S%' });
    } else if (type === 'G') {
      qb.andWhere('(jv.jvType = :tG OR d.docNbr LIKE :gPrefix)', { tG: 'G', gPrefix: 'G%' });
    } else {
      // ALL → include everything for this customer (receipts, manual JVs, returns, etc.)
    }
    return qb;
  };

  // 4) Main period query (all rows for the customer, filtered by date and type)
  const qb = this.journalVoucherDetailRepository
    .createQueryBuilder('d')
    .leftJoinAndSelect('d.journalVoucher', 'jv')
    .leftJoinAndSelect('d.customer', 'c')
    .where('d.customerId = :customerId', { customerId });

  if (from) qb.andWhere('jv.date >= :from', { from });
  if (to)   qb.andWhere('jv.date <= :to',   { to });

  applyTypeFilter(qb);
  qb.orderBy('jv.date', 'ASC').addOrderBy('d.id', 'ASC');

  const rows = await qb.getMany();

  // 5) Opening balance (same filters; per-row column choice by JV type/docNbr)
  let openingBalance = 0;
  if (from) {
    const beforeQb = this.journalVoucherDetailRepository
      .createQueryBuilder('d')
      .leftJoin('d.journalVoucher', 'jv')
      .where('d.customerId = :customerId', { customerId })
      .andWhere('jv.date < :from', { from });

    applyTypeFilter(beforeQb);
    const beforeRows = await beforeQb.getMany();

    let openingDr = 0;
    let openingCr = 0;
    for (const r of beforeRows) {
      const isG = r.journalVoucher?.jvType === 'G' || (r.docNbr?.startsWith('G') ?? false);
      const rowKind: RowKind = isG ? 'G' : 'S';
      const { drCol, crCol } = getColsFor(rowKind);
      openingDr += Number((r as any)[drCol] || 0);
      openingCr += Number((r as any)[crCol] || 0);
    }
    openingBalance = openingDr - openingCr;
  }

  // 6) Items + running balance (per-row column choice by JV type/docNbr)
  let running = openingBalance;
  const items = rows.map((r) => {
    const isG = r.journalVoucher?.jvType === 'G' || (r.docNbr?.startsWith('G') ?? false);
    const rowKind: RowKind = isG ? 'G' : 'S';

    const { drCol, crCol } = getColsFor(rowKind);
    const debit  = Number((r as any)[drCol] || 0);
    const credit = Number((r as any)[crCol] || 0);
    running += debit - credit;

    return {
      journalVoucherId: r.journalVoucherId,
      date: r.journalVoucher?.date,
      jvNumber: r.journalVoucher?.jvNumber,
      description: r.description ?? null,
      docNbr: r.docNbr ?? null,
      kind: rowKind, // 'S' (non-OFR) or 'G' (OFR)
      debit,
      credit,
      balanceAfter: running,
      exRateUSD: currencyCode === 'LL' ? Number(r.exRateUSD || 0) : undefined,
      exRateEUROToUSD: currencyCode === 'EURO' ? Number(r.exRateEUROToUSD || 0) : undefined,
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

  // 7) Basis note (for debugging/visibility)
  const exampleCols = getColsFor('S');
  const basis = {
    currency: currencyCode,
    sUses: { debitColumn: exampleCols.drCol as string, creditColumn: exampleCols.crCol as string },
    gUses: {
      debitColumn: (ofrColMap[currencyCode] ?? ofrColMap.USD).dr,
      creditColumn: (ofrColMap[currencyCode] ?? ofrColMap.USD).cr,
    },
    selection: type, // S | G | ALL
  };

  return {
    customerId,
    from: from ?? null,
    to: to ?? null,
    openingBalance,
    totals,
    closingBalance: running,
    items,
    basis,
  };
}


async getAccountStatementOFR(params: {
  accountId: number;
  type?: 'S' | 'G' | 'ALL';
  from?: string; // 'YYYY-MM-DD'
  to?: string;   // 'YYYY-MM-DD'
}) {
  const { accountId, type = 'ALL', from, to } = params;

  // 1) Load account & infer currency
  const account = await this.accountRepository.findOne({
    where: { id: accountId },
    relations: ['currency'],
  });
  if (!account) throw new NotFoundException(`Account ${accountId} not found`);

  let currencyCode =
    (account as any)?.currency?.code as 'USD' | 'LL' | 'EURO' | 'BASE' | undefined;
  if (!currencyCode) {
    // fallback if you only store numeric currencyId
    currencyCode = (account as any)?.currencyId === 2 ? 'LL' : 'USD';
  }

  // 2) Column maps
  const ofrColMap = {
    USD:  { dr: 'drUSDOFR',  cr: 'crUSDOFR'  },
    LL:   { dr: 'drLLOFR',   cr: 'crLLOFR'   },
    EURO: { dr: 'drOFR',     cr: 'crOFR'     },
    BASE: { dr: 'drOFR',     cr: 'crOFR'     },
  } as const;

  const baseColMap = {
    USD:  { dr: 'drUSD',  cr: 'crUSD'  },
    LL:   { dr: 'drLL',   cr: 'crLL'   },
    EURO: { dr: 'dr',     cr: 'cr'     },
    BASE: { dr: 'dr',     cr: 'cr'     },
  } as const;

  type RowKind = 'S' | 'G';
  const getColsFor = (rowKind: RowKind) => {
    if (rowKind === 'G') {
      const p = ofrColMap[currencyCode] ?? ofrColMap.USD;
      return { drCol: p.dr as keyof JournalVoucherDetail, crCol: p.cr as keyof JournalVoucherDetail };
    }
    const p = baseColMap[currencyCode] ?? baseColMap.USD;
    return { drCol: p.dr as keyof JournalVoucherDetail, crCol: p.cr as keyof JournalVoucherDetail };
  };

  // 3) Type filter
  const applyTypeFilter = (
    qb: ReturnType<typeof this.journalVoucherDetailRepository.createQueryBuilder>
  ) => {
    if (type === 'S') {
      qb.andWhere('(jv.jvType = :tS OR d.docNbr LIKE :sPrefix)', { tS: 'S', sPrefix: 'S%' });
    } else if (type === 'G') {
      qb.andWhere('(jv.jvType = :tG OR d.docNbr LIKE :gPrefix)', { tG: 'G', gPrefix: 'G%' });
    }
    return qb;
  };

  // 4) Period rows for this account
  const qb = this.journalVoucherDetailRepository
    .createQueryBuilder('d')
    .leftJoinAndSelect('d.journalVoucher', 'jv')
    .where('d.accountId = :accountId', { accountId });

  if (from) qb.andWhere('jv.date >= :from', { from });
  if (to)   qb.andWhere('jv.date <= :to',   { to });

  applyTypeFilter(qb);
  qb.orderBy('jv.date', 'ASC').addOrderBy('d.id', 'ASC');

  const rows = await qb.getMany();

  // 5) Opening balance (before "from")
  let openingBalance = 0;
  if (from) {
    const beforeQb = this.journalVoucherDetailRepository
      .createQueryBuilder('d')
      .leftJoin('d.journalVoucher', 'jv')
      .where('d.accountId = :accountId', { accountId })
      .andWhere('jv.date < :from', { from });

    applyTypeFilter(beforeQb);
    const beforeRows = await beforeQb.getMany();

    let openingDr = 0, openingCr = 0;
    for (const r of beforeRows) {
      const isG = r.journalVoucher?.jvType === 'G' || (r.docNbr?.startsWith('G') ?? false);
      const { drCol, crCol } = getColsFor(isG ? 'G' : 'S');
      openingDr += Number((r as any)[drCol] || 0);
      openingCr += Number((r as any)[crCol] || 0);
    }
    openingBalance = openingDr - openingCr;
  }

  // 6) Items + running balance
  let running = openingBalance;
  const items = rows.map((r) => {
    const isG = r.journalVoucher?.jvType === 'G' || (r.docNbr?.startsWith('G') ?? false);
    const { drCol, crCol } = getColsFor(isG ? 'G' : 'S');

    const debit  = Number((r as any)[drCol] || 0);
    const credit = Number((r as any)[crCol] || 0);
    running += debit - credit;

    return {
      journalVoucherId: r.journalVoucherId,
      date: r.journalVoucher?.date,
      jvNumber: r.journalVoucher?.jvNumber,
      description: r.description ?? null,
      docNbr: r.docNbr ?? null,
      kind: isG ? 'G' : 'S',
      debit,
      credit,
      balanceAfter: running,
      exRateUSD:  currencyCode === 'LL'   ? Number(r.exRateUSD || 0)      : undefined,
      exRateEUROToUSD: currencyCode === 'EURO' ? Number(r.exRateEUROToUSD || 0) : undefined,
    };
  });

  const totals = items.reduce(
    (t, it) => {
      t.totalDebit  += it.debit;
      t.totalCredit += it.credit;
      return t;
    },
    { totalDebit: 0, totalCredit: 0 }
  );

  const exampleColsS = getColsFor('S');
  return {
    accountId,
    accountCode: (account as Account).accountNumber,
    accountName: (account as Account).accountName,
    from: from ?? null,
    to: to ?? null,
    openingBalance,
    totals,
    closingBalance: running,
    items,
    basis: {
      currency: currencyCode,
      sUses: { debitColumn: exampleColsS.drCol as string, creditColumn: exampleColsS.crCol as string },
      gUses: {
        debitColumn: (ofrColMap[currencyCode] ?? ofrColMap.USD).dr,
        creditColumn: (ofrColMap[currencyCode] ?? ofrColMap.USD).cr,
      },
      selection: type,
    },
  };
}




}
