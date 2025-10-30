import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Brackets } from 'typeorm';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { Customer } from 'src/entities/customer.entity';
import { Settings } from 'src/entities/settings.entity'; 
import { QueryFailedError } from 'typeorm';
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
     @InjectRepository(Settings)
  private readonly settingsRepo: Repository<Settings>, 
  ) {}


private toN(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}




  private async getActiveYearYY(): Promise<string> {
  const active = await this.settingsRepo.findOne({ where: { isActive: true } });
  if (!active) {
    throw new BadRequestException('Active fiscal year is not configured in Settings.');
  }
  const raw = (active.year ?? '').toString().trim();

  // keep only digits
  const digits = raw.replace(/\D/g, '');
  if (!digits) throw new BadRequestException('Settings.year must contain digits (e.g., "25" or "2025").');

  // If 4 digits (e.g. 2025) → take last two, else pad to 2
  const yy = digits.length >= 2 ? digits.slice(-2) : digits.padStart(2, '0');
  return yy;
}


async createJournalVoucher(data: {
  date: Date;
  jvType: string; // 'S' | 'G' | 'SR'
  details: {
    // Exactly one of these three must be provided:
    accountId?: number;
    customerId?: number;
    supplierId?: number;

    description?: string | null;

    // Base amounts
    debit: string;
    debitUSD: string;
    debitLL: string;
    credit: string;
    creditUSD: string;
    creditLL: string;

    // OFR amounts
    debitOFR?: string;
    debitUSDOFR?: string;
    debitLLOFR?: string;
    creditOFR?: string;
    creditUSDOFR?: string;
    creditLLOFR?: string;

    currency: string;
    exchangeRateEURtoUSD: string;
    exchangeRate: string;
    docNbr?: string | null;
  }[];
}): Promise<JournalVoucher> {
  const { date, jvType, details } = data;

  // 1) Validate JV type
  if (!jvType || !['S', 'G', 'SR'].includes(jvType)) {
    throw new BadRequestException('Invalid JV type. Must be "S", "G", or "SR".');
  }

  // 2) Validate details exist
  if (!details || details.length === 0) {
    throw new BadRequestException('Voucher must have at least one detail.');
  }

  // 3) Generate JV number: JV{YY}-#####   (G type uses JVG{YY}-#####)
  const yy = await this.getActiveYearYY(); // e.g. "25"
  const basePrefix = jvType === 'G' ? 'JVG' : 'JV';
  const seriesPrefix = `${basePrefix}${yy}-`; // e.g. "JV25-" or "JVG25-"

  // Look up the last voucher within the same series (year + type prefix)
  const lastInSeries = await this.journalVoucherRepository.find({
    where: { jvNumber: Like(`${seriesPrefix}%`) },
    order: { jvNumber: 'DESC' }, // safe because the numeric part is zero-padded
    take: 1,
  });

  const nextSeq =
    lastInSeries.length > 0
      ? (parseInt(lastInSeries[0].jvNumber.replace(seriesPrefix, ''), 10) || 0) + 1
      : 1;

  const jvNumber = `${seriesPrefix}${String(nextSeq).padStart(3, '0')}`;

  // helper to parse numbers safely (handles "", null, commas)
  const toN = (v: any) => {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  // 4) Map input rows → entity rows (base + OFR)
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

    const basePayload: Partial<JournalVoucherDetail> = {
      description: detail.description ?? null,

      // Base columns
      dr: toN(detail.debit),
      drUSD: toN(detail.debitUSD),
      drLL: toN(detail.debitLL),
      cr: toN(detail.credit),
      crUSD: toN(detail.creditUSD),
      crLL: toN(detail.creditLL),

      // OFR columns
      drOFR: toN(detail.debitOFR),
      drUSDOFR: toN(detail.debitUSDOFR),
      drLLOFR: toN(detail.debitLLOFR),
      crOFR: toN(detail.creditOFR),
      crUSDOFR: toN(detail.creditUSDOFR),
      crLLOFR: toN(detail.creditLLOFR),

      currency: detail.currency,
      exRateEUROToUSD: toN(detail.exchangeRateEURtoUSD),
      exRateUSD: toN(detail.exchangeRate),
      docNbr: detail.docNbr ?? null,
    };

    // Attach the correct FK column (exactly one)
    if (detail.accountId) {
      (basePayload as any).accountId = detail.accountId;
    } else if (detail.customerId) {
      (basePayload as any).customerId = detail.customerId;
    } else if (detail.supplierId) {
      (basePayload as any).supplierId = detail.supplierId;
    }

    return this.journalVoucherDetailRepository.create(basePayload);
  });

  // 5) Header totals — compute BOTH base and OFR totals
  const sum = <K extends keyof JournalVoucherDetail>(key: K) =>
    resolvedDetails.reduce((acc, d) => acc + toN((d as any)[key]), 0);

  // Base totals
  const totalDr       = sum('dr');
  const totalDrUSD    = sum('drUSD');
  const totalDrLL     = sum('drLL');
  const totalCr       = sum('cr');
  const totalCrUSD    = sum('crUSD');
  const totalCrLL     = sum('crLL');

  // OFR totals
  const totalDrOFR     = sum('drOFR');
  const totalDrUSDOFR  = sum('drUSDOFR');
  const totalDrLLOFR   = sum('drLLOFR');
  const totalCrOFR     = sum('crOFR');
  const totalCrUSDOFR  = sum('crUSDOFR');
  const totalCrLLOFR   = sum('crLLOFR');

  // 6) Create header
  const journalVoucher = this.journalVoucherRepository.create({
    date,
    jvType,
    jvNumber,

    // Base totals
    totalDr,
    totalDrUSD,
    totalDrLL,
    totalCr,
    totalCrUSD,
    totalCrLL,

    // OFR totals
    totalDrOFR,
    totalDrUSDOFR,
    totalDrLLOFR,
    totalCrOFR,
    totalCrUSDOFR,
    totalCrLLOFR,

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

 

  async deleteJournalVoucher(id: number): Promise<void> {
    const journalVoucher = await this.getJournalVoucherById(id);
    await this.journalVoucherRepository.remove(journalVoucher);
  }

async getVoucherSummary(params?: {
  page?: number;
  limit?: number;   // we’ll hard-cap to 100
  q?: string;
}): Promise<{
  data: { id: number; date: Date; jvNumber: string; jvType: string; description: string }[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}> {
  const page = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 100)));
  const q = (params?.q ?? '').trim();

  // ---------- 1) COUNT DISTINCT (for total/hasMore) ----------
  const countQb = this.journalVoucherRepository
    .createQueryBuilder('jv')
    .leftJoin('jv.details', 'd');

  if (q) {
    const like = `%${q}%`;
    countQb.andWhere(new Brackets((w) => {
      w.where('jv.jvNumber ILIKE :like', { like })
       .orWhere('jv.jvType ILIKE :like', { like })
       .orWhere('d.description ILIKE :like', { like });
    }));
  }

  const { cnt } = await countQb
    .select('COUNT(DISTINCT jv.id)', 'cnt')
    .getRawOne<{ cnt: string }>();

  const total = Number(cnt || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = page < totalPages;

  if (total === 0) {
    return { data: [], page, limit, total, totalPages, hasMore: false };
  }

  // ---------- 2) PAGE OF IDS (ONLY ids, ordered, offset/limit) ----------
  const idQb = this.journalVoucherRepository
    .createQueryBuilder('jv')
    .leftJoin('jv.details', 'd')
    .select('jv.id', 'id');

  if (q) {
    const like = `%${q}%`;
    idQb.andWhere(new Brackets((w) => {
      w.where('jv.jvNumber ILIKE :like', { like })
       .orWhere('jv.jvType ILIKE :like', { like })
       .orWhere('d.description ILIKE :like', { like });
    }));
  }

  const idRows = await idQb
    .groupBy('jv.id')
    .orderBy('jv.date', 'DESC')
    .addOrderBy('jv.id', 'DESC')
    .offset((page - 1) * limit)   // <-- true OFFSET/LIMIT
    .limit(limit)
    .getRawMany<{ id: number }>();

  const ids = idRows.map(r => Number(r.id));
  if (ids.length === 0) {
    return { data: [], page, limit, total, totalPages, hasMore };
  }

  // ---------- 3) FETCH FIELDS FOR JUST THOSE IDS ----------
  const rows = await this.journalVoucherRepository
    .createQueryBuilder('jv')
    .leftJoin('jv.details', 'd')
    .select([
      'jv.id AS id',
      'jv.date AS date',
      'jv.jvNumber AS "jvNumber"',
      'jv.jvType AS "jvType"',
    ])
    .addSelect('MIN(CASE WHEN d.dr > 0 THEN d.description END)', 'description')
    .where('jv.id IN (:...ids)', { ids })
    .groupBy('jv.id')
    .addGroupBy('jv.date')
    .addGroupBy('jv.jvNumber')
    .addGroupBy('jv.jvType')
    // keep the same order as the id page (date desc, id desc)
    .orderBy('jv.date', 'DESC')
    .addOrderBy('jv.id', 'DESC')
    .getRawMany<{
      id: number;
      date: Date;
      jvNumber: string;
      jvType: string;
      description: string | null;
    }>();

  // ---------- 4) Normalize ----------
  const data = rows.map(r => ({
    id: Number(r.id),
    date: r.date,
    jvNumber: r.jvNumber,
    jvType: r.jvType,
    description: r.description ?? 'No Description',
    
  }));

  return { data, page, limit, total, totalPages, hasMore };
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

  // 🔹 Try common field names for account number; keep null if none found
  const customerAccountNumber: string | null =
    (customer as any)?.customerAccountNumber ??
    (customer as any)?.accountNumber ??
    null;

  // 🔹 NEW: surface customer's invoice type from the customer table
  const customerInvoiceType: string | null =
    (customer as any)?.invoiceType ?? null;

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
    } else {
      // ALL
    }
    return qb;
  };

  // 4) Main period query
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

  // 5) Opening balance
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

  // 6) Items + running balance
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
      kind: rowKind,
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

  // 7) Basis note (debug)
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
    currencyCode,               
    customerAccountNumber,     
    customerInvoiceType,       
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

  // 1) Load account (for metadata)
  const account = await this.accountRepository.findOne({
    where: { id: accountId },
    relations: ['currency'],
  });
  if (!account) throw new NotFoundException(`Account ${accountId} not found`);

  // Helper: normalize jvType -> 'S' | 'G'
  const rowKind = (r: JournalVoucherDetail): 'S' | 'G' => {
    const t = (r.journalVoucher?.jvType ?? '').trim().toUpperCase();
    return t === 'G' ? 'G' : 'S';
  };

  // Pick numbers based on jvType
  const amounts = (r: JournalVoucherDetail) => {
    const kind = rowKind(r);
    if (kind === 'G') {
      // G => USD OFR only
      const debit  = Number(r.drUSDOFR || 0);
      const credit = Number(r.crUSDOFR || 0);
      return { kind, debit, credit };
    }
    // S => USD only
    const debit  = Number(r.drUSD || 0);
    const credit = Number(r.crUSD || 0);
    return { kind, debit, credit };
  };

  // 2) Build the period query
  const qb = this.journalVoucherDetailRepository
    .createQueryBuilder('d')
    .leftJoinAndSelect('d.journalVoucher', 'jv')
    .where('d.accountId = :accountId', { accountId });

  if (from) qb.andWhere('jv.date >= :from', { from });
  if (to)   qb.andWhere('jv.date <= :to',   { to });

  // Filter by jvType only when S or G is requested
  if (type === 'S') qb.andWhere('jv.jvType = :tt', { tt: 'S' });
  if (type === 'G') qb.andWhere('jv.jvType = :tt', { tt: 'G' });

  qb.orderBy('jv.date', 'ASC').addOrderBy('d.id', 'ASC');
  const periodRows = await qb.getMany();

  // 3) Opening balance (strictly before "from") — same rules
  let openingBalance = 0;
  if (from) {
    const beforeQb = this.journalVoucherDetailRepository
      .createQueryBuilder('d')
      .leftJoin('d.journalVoucher', 'jv')
      .where('d.accountId = :accountId', { accountId })
      .andWhere('jv.date < :from', { from });

    if (type === 'S') beforeQb.andWhere('jv.jvType = :tt', { tt: 'S' });
    if (type === 'G') beforeQb.andWhere('jv.jvType = :tt', { tt: 'G' });

    const beforeRows = await beforeQb.getMany();

    let dr = 0, cr = 0;
    for (const r of beforeRows) {
      const { kind, debit, credit } = amounts(r);
      if (type === 'ALL' || type === kind) {
        dr += debit;
        cr += credit;
      }
    }
    openingBalance = dr - cr;
  }

  // 4) Items + running balance (each row uses the proper columns by its jvType)
  let running = openingBalance;
  const allItems = periodRows.map((r) => {
    const { kind, debit, credit } = amounts(r);
    return { r, kind, debit, credit };
  });

  const filtered = (type === 'ALL') ? allItems : allItems.filter(x => x.kind === type);

  const items = filtered.map(({ r, kind, debit, credit }) => {
    running += debit - credit;
    return {
      journalVoucherId: r.journalVoucherId,
      date: r.journalVoucher?.date,
      jvNumber: r.journalVoucher?.jvNumber,
      description: r.description ?? null,
      docNbr: r.docNbr ?? null,
      kind,                // 'S' or 'G' (from jvType)
      debit,
      credit,
      balanceAfter: running,
      // pass through rates if you want to show them; not used in math here
      exRateUSD: r.exRateUSD ?? undefined,
      exRateEUROToUSD: r.exRateEUROToUSD ?? undefined,
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

  return {
    accountId,
    accountCode: (account as any).accountNumber,
    accountName: (account as any).accountName,
    from: from ?? null,
    to: to ?? null,
    openingBalance,
    totals,
    closingBalance: running,
    items,
    basis: {
      selection: type,
      columnBasis: {
        S: { debit: 'drUSD',    credit: 'crUSD'    },
        G: { debit: 'drUSDOFR', credit: 'crUSDOFR' },
      },
      filterBasis: 'SQL filter on jv.jvType when S/G, none when ALL',
    },
  };
}




private static readonly TRAILING_DIGITS_EXPR =
    `substring(jv."jvNumber" from '([0-9]+)$')`;


async searchBySeq(params?: { seq?: string; page?: number; limit?: number }) {
  const page  = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 100)));

  const seqDigits = (params?.seq ?? '').replace(/\D+/g, '');

  if (!seqDigits) {
    return this.getVoucherSummary({ page, limit });
  }

  const seqExpr = 'REGEXP_SUBSTR(jv.jvNumber, "[0-9]+$")';

  // 1) COUNT
  const countQb = this.journalVoucherRepository.createQueryBuilder('jv');
  countQb.andWhere(
    `(${seqExpr}) = :seq OR CAST((${seqExpr}) AS UNSIGNED) = :seqNum`,
    { seq: seqDigits, seqNum: Number(seqDigits) }
  );
  const { cnt } = await countQb
    .select('COUNT(DISTINCT jv.id)', 'cnt')
    .getRawOne<{ cnt: string }>();
  const total = Number(cnt || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = page < totalPages;
  if (total === 0) {
    return { data: [], page, limit, total, totalPages, hasMore: false };
  }

  // 2) PAGE OF IDS
  const idQb = this.journalVoucherRepository
    .createQueryBuilder('jv')
    .select('jv.id', 'id')
    .andWhere(
      `(${seqExpr}) = :seq OR CAST((${seqExpr}) AS UNSIGNED) = :seqNum`,
      { seq: seqDigits, seqNum: Number(seqDigits) }
    );

  const idRows = await idQb
    .groupBy('jv.id')
    .orderBy('jv.date', 'DESC')
    .addOrderBy('jv.id', 'DESC')
    .offset((page - 1) * limit)
    .limit(limit)
    .getRawMany<{ id: number }>();

  const ids = idRows.map(r => Number(r.id));
  if (ids.length === 0) {
    return { data: [], page, limit, total, totalPages, hasMore };
  }

  // 3) FETCH FIELDS FOR THOSE IDS
  const rows = await this.journalVoucherRepository
    .createQueryBuilder('jv')
    .leftJoin('jv.details', 'd')
    .select([
      'jv.id AS id',
      'jv.date AS date',
      'jv.jvNumber AS "jvNumber"',
      'jv.jvType AS "jvType"',
    ])
    .addSelect('MIN(CASE WHEN d.dr > 0 THEN d.description END)', 'description')
    .where('jv.id IN (:...ids)', { ids })
    .groupBy('jv.id')
    .addGroupBy('jv.date')
    .addGroupBy('jv.jvNumber')
    .addGroupBy('jv.jvType')
    .orderBy('jv.date', 'DESC')
    .addOrderBy('jv.id', 'DESC')
    .getRawMany();

  const data = rows.map(r => ({
    id: Number(r.id),
    date: r.date,
    jvNumber: r.jvNumber,
    jvType: r.jvType,
    description: r.description ?? 'No Description',
  }));

  return { data, page, limit, total, totalPages, hasMore };
}









  async updateJournalVoucherFull(
    id: number,
    data: {
      date: Date | string;
      jvType: 'S' | 'G' | 'SR';
      details: Array<{
        accountId?: number;
        customerId?: number;
        supplierId?: number;

        description?: string | null;

        // Base (S/SR) amounts
        debit?: string | number;
        debitUSD?: string | number;
        debitLL?: string | number;
        credit?: string | number;
        creditUSD?: string | number;
        creditLL?: string | number;

        // OFR (G) amounts
        debitOFR?: string | number;
        debitUSDOFR?: string | number;
        debitLLOFR?: string | number;
        creditOFR?: string | number;
        creditUSDOFR?: string | number;
        creditLLOFR?: string | number;

        currency?: string;
        exchangeRateEURtoUSD?: string | number;
        exchangeRate?: string | number;
        docNbr?: string | null;
      }>;
    },
  ): Promise<JournalVoucher> {
    const existing = await this.journalVoucherRepository.findOne({
      where: { id },
      relations: ['details'],
    });
    if (!existing) throw new NotFoundException(`Journal Voucher ${id} not found`);

    const { date, jvType, details } = data;

    if (!jvType || !['S', 'G', 'SR'].includes(jvType)) {
      throw new BadRequestException('Invalid JV type. Must be "S", "G", or "SR".');
    }
    if (!details || details.length === 0) {
      throw new BadRequestException('Voucher must have at least one detail.');
    }

    // Helpers
    const toN = (v: any) => {
      if (v === null || v === undefined || v === '') return 0;
      const s = String(v).replace(/,/g, '');
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    };

    // Map details → entity rows, ALWAYS setting all numeric columns
    const newDetails: JournalVoucherDetail[] = details.map((row, idx) => {
      const flags = [(row.accountId ? 1 : 0), (row.customerId ? 1 : 0), (row.supplierId ? 1 : 0)];
      const targets = flags.reduce((a, b) => a + b, 0);
      if (targets !== 1) {
        throw new BadRequestException(
          `Each detail must provide exactly one of accountId/customerId/supplierId (row ${idx + 1}).`,
        );
      }

      // Base
      let dr = toN(row.debit);
      let drUSD = toN(row.debitUSD);
      let drLL = toN(row.debitLL);
      let cr = toN(row.credit);
      let crUSD = toN(row.creditUSD);
      let crLL = toN(row.creditLL);

      // OFR
      const drOFR = toN(row.debitOFR);
      const drUSDOFR = toN(row.debitUSDOFR);
      const drLLOFR = toN(row.debitLLOFR);
      const crOFR = toN(row.creditOFR);
      const crUSDOFR = toN(row.creditUSDOFR);
      const crLLOFR = toN(row.creditLLOFR);

      // For type G, force base columns to 0 (critical for MySQL strict mode)
      if (jvType === 'G') {
        dr = 0; drUSD = 0; drLL = 0;
        cr = 0; crUSD = 0; crLL = 0;
      }

      const entity = this.journalVoucherDetailRepository.create({
        description: row.description ?? null,
        currency: row.currency ?? null,
        exRateEUROToUSD: toN(row.exchangeRateEURtoUSD),
        exRateUSD: toN(row.exchangeRate),
        docNbr: row.docNbr ?? null,

        // base (ALWAYS present)
        dr, drUSD, drLL,
        cr, crUSD, crLL,

        // OFR (ALWAYS present)
        drOFR, drUSDOFR, drLLOFR,
        crOFR, crUSDOFR, crLLOFR,
      });

      if (row.accountId) (entity as any).accountId = row.accountId;
      if (row.customerId) (entity as any).customerId = row.customerId;
      if (row.supplierId) (entity as any).supplierId = row.supplierId;

      return entity;
    });

    // Recompute totals
    const totals = newDetails.reduce(
      (t, d) => {
        t.totalDr += toN(d.dr);
        t.totalDrUSD += toN(d.drUSD);
        t.totalDrLL += toN(d.drLL);
        t.totalDrOFR += toN(d.drOFR);
        t.totalDrUSDOFR += toN(d.drUSDOFR);
        t.totalDrLLOFR += toN(d.drLLOFR);

        t.totalCr += toN(d.cr);
        t.totalCrUSD += toN(d.crUSD);
        t.totalCrLL += toN(d.crLL);
        t.totalCrOFR += toN(d.crOFR);
        t.totalCrUSDOFR += toN(d.crUSDOFR);
        t.totalCrLLOFR += toN(d.crLLOFR);
        return t;
      },
      {
        totalDr: 0, totalDrUSD: 0, totalDrLL: 0,
        totalDrOFR: 0, totalDrUSDOFR: 0, totalDrLLOFR: 0,
        totalCr: 0, totalCrUSD: 0, totalCrLL: 0,
        totalCrOFR: 0, totalCrUSDOFR: 0, totalCrLLOFR: 0,
      },
    );

    // Replace header fields
    existing.date = (date as any) as Date;
    existing.jvType = jvType;

    // Replace details: easiest is to remove existing and insert new
    await this.journalVoucherDetailRepository.delete({ journalVoucherId: existing.id });

    existing.details = newDetails;

    // Assign totals
    existing.totalDr = totals.totalDr;
    existing.totalDrUSD = totals.totalDrUSD;
    existing.totalDrLL = totals.totalDrLL;
    existing.totalDrOFR = totals.totalDrOFR;
    existing.totalDrUSDOFR = totals.totalDrUSDOFR;
    existing.totalDrLLOFR = totals.totalDrLLOFR;

    existing.totalCr = totals.totalCr;
    existing.totalCrUSD = totals.totalCrUSD;
    existing.totalCrLL = totals.totalCrLL;
    existing.totalCrOFR = totals.totalCrOFR;
    existing.totalCrUSDOFR = totals.totalCrUSDOFR;
    existing.totalCrLLOFR = totals.totalCrLLOFR;

    return this.journalVoucherRepository.save(existing);
  }


}
