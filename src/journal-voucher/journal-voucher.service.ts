import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Brackets, SelectQueryBuilder } from 'typeorm';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';
import { Customer } from 'src/entities/customer.entity';
import { Settings } from 'src/entities/settings.entity'; 
import { QueryFailedError } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { ReceiptEntry } from '../entities/recievables.entities'; // ✅ adjust path
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity'; // ✅ adjust path
import { Supplier } from '../entities/supplier.entity'; // ✅ adjust path



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
       @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
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
  limit?: number; // hard-cap 100
  q?: string;
}): Promise<{
  data: {
    id: number;
    date: Date;
    jvNumber: string;
    jvType: string;
    description: string;

    name: string;
    kind: 'INVOICE' | 'RECEIVABLE' | 'PURCHASE' | 'JV';
    customerName?: string | null;
    invoiceNumber?: string | null;
    invoiceId?: number | null;
    receiptCurrency?: string | null;
  }[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}> {
  const page = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 100)));
  const qRaw = (params?.q ?? '').trim();
  const like = `%${qRaw}%`;
  const likeLower = `%${qRaw.toLowerCase()}%`;

  const applyJoins = (qb: SelectQueryBuilder<JournalVoucher>) => {
    return qb
      // JV details (explicit join condition, MySQL-safe)
      .leftJoin(JournalVoucherDetail, 'd', 'd.journalVoucherId = jv.id')

      // receivable tables (use table names for customer/invoice to avoid relation-path issues)
      .leftJoin(ReceiptEntry, 're', 're.journalVoucherId = jv.id')
      .leftJoin('customers', 'rcust', 'rcust.id = re.customerId')
      .leftJoin('invoices', 'sinv', 'sinv.id = re.invoiceId')
      .leftJoin('customers', 'sinvCust', 'sinvCust.id = sinv.customerId')

      // purchase invoice (explicit FK join; does NOT require jv.invoice relation)
      .leftJoin(PurchaseInvoice, 'pinv', 'pinv.id = jv.purchaseInvoiceId')
      .leftJoin(Supplier, 'psup', 'psup.id = pinv.supplierId')

      // ✅ IMPORTANT: detect ANY sales invoice type (S/G/RVR/RTN) using docNbr
      .leftJoin('invoices', 'dinv', 'dinv.invoiceNumber = d.docNbr')
      .leftJoin('customers', 'dinvCust', 'dinvCust.id = dinv.customerId');
  };

  const applySearch = (qb: SelectQueryBuilder<JournalVoucher>) => {
    if (!qRaw) return;

    qb.andWhere(
      new Brackets((w) => {
        // Use LOWER(... ) LIKE ... to be safe cross-collation
        w.where('LOWER(jv.jvNumber) LIKE :likeLower', { likeLower })
          .orWhere('LOWER(jv.jvType) LIKE :likeLower', { likeLower })
          .orWhere('LOWER(d.description) LIKE :likeLower', { likeLower })

          // receivable
          .orWhere('LOWER(rcust.customerName) LIKE :likeLower', { likeLower })
          .orWhere('LOWER(sinv.invoiceNumber) LIKE :likeLower', { likeLower })
          .orWhere('LOWER(sinvCust.customerName) LIKE :likeLower', { likeLower })

          // purchase
          .orWhere('LOWER(pinv.invoiceNumber) LIKE :likeLower', { likeLower })
          .orWhere('LOWER(psup.supplierName) LIKE :likeLower', { likeLower })

          // docNbr invoice
          .orWhere('LOWER(dinv.invoiceNumber) LIKE :likeLower', { likeLower })
          .orWhere('LOWER(dinvCust.customerName) LIKE :likeLower', { likeLower });
      }),
    );
  };

  // -----------------------------
  // 1) COUNT DISTINCT (total)
  // -----------------------------
  const countQb = applyJoins(this.journalVoucherRepository.createQueryBuilder('jv'));
  applySearch(countQb);

  const countRow = await countQb
    .select('COUNT(DISTINCT jv.id)', 'cnt')
    .getRawOne<{ cnt: string }>();

  const total = Number(countRow?.cnt || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = page < totalPages;

  if (total === 0) {
    return { data: [], page, limit, total, totalPages, hasMore: false };
  }

  // -----------------------------
  // 2) PAGE OF IDS
  // -----------------------------
  const idQb = applyJoins(this.journalVoucherRepository.createQueryBuilder('jv'))
    .select('jv.id', 'id');

  applySearch(idQb);

  const idRows = await idQb
    .groupBy('jv.id')
    .orderBy('jv.date', 'DESC')
    .addOrderBy('jv.id', 'DESC')
    .skip((page - 1) * limit)
    .take(limit)
    .getRawMany<{ id: number }>();

  const ids = idRows.map((r) => Number(r.id));
  if (ids.length === 0) {
    return { data: [], page, limit, total, totalPages, hasMore };
  }

  // -----------------------------
  // 3) FETCH FIELDS FOR THOSE IDS
  // -----------------------------
  const rows = await applyJoins(this.journalVoucherRepository.createQueryBuilder('jv'))
    .select('jv.id', 'id')
    .addSelect('jv.date', 'date')
    .addSelect('jv.jvNumber', 'jvNumber')
    .addSelect('jv.jvType', 'jvType')
    .addSelect('MIN(CASE WHEN d.dr > 0 THEN d.description END)', 'description')

    // receivable fields
    .addSelect('MAX(re.id)', 'receiptEntryId')
    .addSelect('MAX(re.currency)', 'receiptCurrency')
    .addSelect('MAX(rcust.customerName)', 'receiptCustomerName')

    // receipt->invoice (optional)
    .addSelect('MAX(sinv.id)', 'receiptInvoiceId')
    .addSelect('MAX(sinv.invoiceNumber)', 'receiptInvoiceNumber')
    .addSelect('MAX(sinv.invoiceType)', 'receiptInvoiceType')
    .addSelect('MAX(sinvCust.customerName)', 'receiptInvoiceCustomerName')

    // ✅ docNbr -> invoice (this fixes G/RTN/RVR)
    .addSelect('MAX(dinv.id)', 'docInvoiceId')
    .addSelect('MAX(dinv.invoiceNumber)', 'docInvoiceNumber')
    .addSelect('MAX(dinv.invoiceType)', 'docInvoiceType')
    .addSelect('MAX(dinvCust.customerName)', 'docInvoiceCustomerName')

    // purchase
    .addSelect('MAX(pinv.id)', 'purchaseInvoiceId')
    .addSelect('MAX(pinv.invoiceNumber)', 'purchaseInvoiceNumber')
    .addSelect('MAX(psup.supplierName)', 'purchaseSupplierName')

    .where('jv.id IN (:...ids)', { ids })
    .groupBy('jv.id')
    .addGroupBy('jv.date')
    .addGroupBy('jv.jvNumber')
    .addGroupBy('jv.jvType')
    .orderBy('jv.date', 'DESC')
    .addOrderBy('jv.id', 'DESC')
    .getRawMany<{
      id: number;
      date: Date;
      jvNumber: string;
      jvType: string;
      description: string | null;

      receiptEntryId: number | null;
      receiptCurrency: string | null;
      receiptCustomerName: string | null;

      receiptInvoiceId: number | null;
      receiptInvoiceNumber: string | null;
      receiptInvoiceType: 'S' | 'G' | 'RVR' | 'RTN' | null;
      receiptInvoiceCustomerName: string | null;

      docInvoiceId: number | null;
      docInvoiceNumber: string | null;
      docInvoiceType: 'S' | 'G' | 'RVR' | 'RTN' | null;
      docInvoiceCustomerName: string | null;

      purchaseInvoiceId: number | null;
      purchaseInvoiceNumber: string | null;
      purchaseSupplierName: string | null;
    }>();

  // -----------------------------
  // 4) Normalize + build label
  // -----------------------------
  const data = rows.map((r) => {
    const receiptEntryId = r.receiptEntryId != null ? Number(r.receiptEntryId) : null;

    // prefer receipt-linked invoice, else docNbr-linked invoice
    const invoiceId =
      (r.receiptInvoiceId != null ? Number(r.receiptInvoiceId) : null) ??
      (r.docInvoiceId != null ? Number(r.docInvoiceId) : null) ??
      null;

    const invoiceNumber = r.receiptInvoiceNumber ?? r.docInvoiceNumber ?? null;
    const invoiceType = r.receiptInvoiceType ?? r.docInvoiceType ?? null;
    const invoiceCustomerName =
      r.receiptInvoiceCustomerName ?? r.docInvoiceCustomerName ?? null;

    const purchaseInvoiceId =
      r.purchaseInvoiceId != null ? Number(r.purchaseInvoiceId) : null;

    let kind: 'INVOICE' | 'RECEIVABLE' | 'PURCHASE' | 'JV' = 'JV';
    let name = `قيد يومية - ${r.jvNumber}`.trim();
    let customerName: string | null = null;

    if (invoiceId && invoiceNumber) {
      kind = 'INVOICE';
      customerName = invoiceCustomerName ?? null;

      if (invoiceType === 'RTN') {
        name = `مرتجع - ${customerName ?? ''} - ${invoiceNumber}`.trim();
      } else {
        // show type so G/RVR is clear
        const tag = invoiceType ? ` ${invoiceType}` : '';
        name = `فاتورة${tag} - ${customerName ?? ''} - ${invoiceNumber}`.trim();
      }
    } else if (receiptEntryId) {
      kind = 'RECEIVABLE';
      customerName = r.receiptCustomerName ?? null;

      const cur = (r.receiptCurrency ?? '').toUpperCase();
      const payTag = cur === 'USD' ? 'دفعة $$' : cur === 'LL' ? 'دفعة LL' : 'دفعة';
      name = `${payTag} - ${customerName ?? ''} - ${r.jvNumber}`.trim();
    } else if (purchaseInvoiceId && r.purchaseInvoiceNumber) {
      kind = 'PURCHASE';
      customerName = r.purchaseSupplierName ?? null;
      name = `فاتورة شراء - ${customerName ?? ''} - ${r.purchaseInvoiceNumber}`.trim();
    } else {
      kind = 'JV';
      name = `قيد يومية - ${r.jvNumber}`.trim();
    }

    return {
      id: Number(r.id),
      date: r.date,
      jvNumber: r.jvNumber,
      jvType: r.jvType,
      description: r.description ?? 'No Description',

      name,
      kind,
      customerName,
      invoiceNumber,
      invoiceId,
      receiptCurrency: r.receiptCurrency ?? null,
    };
  });

  return { data, page, limit, total, totalPages, hasMore };
}







async getCustomerStatementOFR(params: {
  customerId: number;
  type?: "S" | "G" | "ALL";
  from?: string; // 'YYYY-MM-DD'
  to?: string; // 'YYYY-MM-DD'
}) {
  const { customerId, type = "ALL", from, to } = params;

  // Helpers: expand YMD range to full-day-safe datetime range
  const ymdToStart = (ymd: string) => `${ymd} 00:00:00`;
  const nextYMD = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const fromStart = from ? ymdToStart(from) : null; // inclusive
  const toNext = to ? ymdToStart(nextYMD(to)) : null; // exclusive

  // 1) Load customer & infer currency
  const customer = await this.customerRepo.findOne({
    where: { id: customerId },
    relations: ["currency"],
  });
  if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

  let currencyCode =
    (customer as any)?.currency?.code as "USD" | "LL" | "EURO" | "BASE" | undefined;
  if (!currencyCode) {
    currencyCode = (customer as any).currencyId === 2 ? "LL" : "USD";
  }

  const customerAccountNumber: string | null =
    (customer as any)?.customerAccountNumber ?? (customer as any)?.accountNumber ?? null;

  const customerInvoiceType: string | null = (customer as any)?.invoiceType ?? null;

  // 2) Column maps
  const ofrColMap = {
    USD: { dr: "drUSDOFR", cr: "crUSDOFR" },
    LL: { dr: "drLLOFR", cr: "crLLOFR" },
    EURO: { dr: "drOFR", cr: "crOFR" },
    BASE: { dr: "drOFR", cr: "crOFR" },
  } as const;

  const baseColMap = {
    USD: { dr: "drUSD", cr: "crUSD" },
    LL: { dr: "drLL", cr: "crLL" },
    EURO: { dr: "dr", cr: "cr" },
    BASE: { dr: "dr", cr: "cr" },
  } as const;

  // ✅ Decide if THIS ROW should use OFR columns or Base columns
  const isOfrRow = (jv: any, docNbr?: string | null) => {
    const jvType = String(jv?.jvType ?? "").trim().toUpperCase();
    const jvNumber = String(jv?.jvNumber ?? "").trim().toUpperCase();
    const doc = String(docNbr ?? "").trim().toUpperCase();

    // If "contains G" in your system means OFR vouchers:
    if (jvType === "G") return true;
    if (jvNumber.startsWith("JVG") || jvNumber.includes("JVG")) return true;

    // Return / Reverse prefixes that indicate OFR
    if (doc.startsWith("RG")) return true;
    if (doc.startsWith("RVG")) return true;

    return false;
  };

  const getColsForRow = (useOfr: boolean) => {
    const map = useOfr
      ? (ofrColMap[currencyCode] ?? ofrColMap.USD)
      : (baseColMap[currencyCode] ?? baseColMap.USD);

    return {
      drCol: map.dr as keyof JournalVoucherDetail,
      crCol: map.cr as keyof JournalVoucherDetail,
    };
  };

  // ✅ Filter by OFR vs Base (NOT by docNbr only, NOT by jvType only)
  const applyTypeFilter = (
    qb: ReturnType<typeof this.journalVoucherDetailRepository.createQueryBuilder>
  ) => {
    if (type === "G") {
      qb.andWhere(
        `(
          UPPER(jv.jvNumber) LIKE 'JVG%'
          OR UPPER(TRIM(jv.jvType)) = 'G'
          OR (d.docNbr IS NOT NULL AND (
            UPPER(TRIM(d.docNbr)) LIKE 'RG%'
            OR UPPER(TRIM(d.docNbr)) LIKE 'RVG%'
          ))
        )`
      );
    } else if (type === "S") {
      qb.andWhere(
        `NOT (
          UPPER(jv.jvNumber) LIKE 'JVG%'
          OR UPPER(TRIM(jv.jvType)) = 'G'
          OR (d.docNbr IS NOT NULL AND (
            UPPER(TRIM(d.docNbr)) LIKE 'RG%'
            OR UPPER(TRIM(d.docNbr)) LIKE 'RVG%'
          ))
        )`
      );
    }
    return qb;
  };

  // 4) Main period query
  const qb = this.journalVoucherDetailRepository
    .createQueryBuilder("d")
    .leftJoinAndSelect("d.journalVoucher", "jv")
    .leftJoinAndSelect("d.customer", "c")
    .where("d.customerId = :customerId", { customerId });

  if (fromStart) qb.andWhere("jv.date >= :fromStart", { fromStart });
  if (toNext) qb.andWhere("jv.date < :toNext", { toNext });

  applyTypeFilter(qb);
  qb.orderBy("jv.date", "ASC").addOrderBy("d.id", "ASC");

  const rows = await qb.getMany();

  // 5) Opening balance (everything BEFORE fromStart)
  let openingBalance = 0;
  if (fromStart) {
    const beforeQb = this.journalVoucherDetailRepository
      .createQueryBuilder("d")
      .leftJoinAndSelect("d.journalVoucher", "jv")
      .where("d.customerId = :customerId", { customerId })
      .andWhere("jv.date < :fromStart", { fromStart });

    applyTypeFilter(beforeQb);

    const beforeRows = await beforeQb.getMany();

    let openingDr = 0;
    let openingCr = 0;

    for (const r of beforeRows) {
      const useOfr = isOfrRow(r.journalVoucher, r.docNbr);
      const { drCol, crCol } = getColsForRow(useOfr);
      openingDr += Number((r as any)[drCol] || 0);
      openingCr += Number((r as any)[crCol] || 0);
    }

    openingBalance = openingDr - openingCr;
  }

  // 6) Items + running balance
  let running = openingBalance;

  const items = rows.map((r) => {
    const useOfr = isOfrRow(r.journalVoucher, r.docNbr);
    const { drCol, crCol } = getColsForRow(useOfr);

    const debit = Number((r as any)[drCol] || 0);
    const credit = Number((r as any)[crCol] || 0);

    running += debit - credit;

    return {
      journalVoucherId: r.journalVoucherId,
      date: r.journalVoucher?.date,
      jvNumber: r.journalVoucher?.jvNumber,
      jvType: r.journalVoucher?.jvType,
      description: r.description ?? null,
      docNbr: r.docNbr ?? null,
      usesOfr: useOfr, // ✅ debug flag so you can see why it picked OFR/Base
      debit,
      credit,
      balanceAfter: running,
      exRateUSD: currencyCode === "LL" ? Number((r as any).exRateUSD || 0) : undefined,
      exRateEUROToUSD:
        currencyCode === "EURO" ? Number((r as any).exRateEUROToUSD || 0) : undefined,
    };
  });

  const totals = items.reduce(
    (acc, li) => {
      acc.totalDebit += li.debit;
      acc.totalCredit += li.credit;
      return acc;
    },
    { totalDebit: 0, totalCredit: 0 }
  );

  const basis = {
    currency: currencyCode,
    selection: type,
    range: { fromStart, toNext },
    baseUses: baseColMap[currencyCode] ?? baseColMap.USD,
    ofrUses: ofrColMap[currencyCode] ?? ofrColMap.USD,
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


async getCustomerBalancesReport(params: {
  to?: string; // 'YYYY-MM-DD'
  type?: 'S' | 'G' | 'ALL';
  minBalance?: number; // NEW: minimum balance filter
}) {
  const { to, type = 'ALL', minBalance } = params;

  // Helper: expand YMD to full-day datetime
  const ymdToStart = (ymd: string) => `${ymd} 00:00:00`;
  const nextYMD = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Default to today if not provided
  const today = new Date();
  const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const toDate = to || todayYMD;
  const toNext = ymdToStart(nextYMD(toDate)); // exclusive end

  // Type filter: S includes everything except G; G is only G; ALL is everything
  const applyTypeFilter = (
    qb: ReturnType<typeof this.journalVoucherDetailRepository.createQueryBuilder>
  ) => {
    if (type === 'S') {
      // S = Sales-related: Include S, RVR, RTN, SR, etc. - everything EXCEPT G
      qb.andWhere('jv.jvType != :gType', { gType: 'G' });
    } else if (type === 'G') {
      // G = Offers only
      qb.andWhere('jv.jvType = :gType', { gType: 'G' });
    }
    // type === 'ALL' = no filter, include everything
    return qb;
  };

  // Get all customers
  const customers = await this.customerRepo.find({
    relations: ['currency'],
    order: { customerName: 'ASC' },
  });

  const results = [];

  for (const customer of customers) {
    const customerId = customer.id;

    // Determine currency
    let currencyCode =
      (customer as any)?.currency?.code as 'USD' | 'LL' | 'EURO' | 'BASE' | undefined;
    if (!currencyCode) {
      currencyCode = (customer as any).currencyId === 2 ? 'LL' : 'USD';
    }

    const customerAccountNumber: string | null =
      (customer as any)?.customerAccountNumber ?? (customer as any)?.accountNumber ?? null;

    // Column maps for OFR (used by G type)
    const ofrColMap = {
      USD: { dr: 'drUSDOFR', cr: 'crUSDOFR' },
      LL: { dr: 'drLLOFR', cr: 'crLLOFR' },
      EURO: { dr: 'drOFR', cr: 'crOFR' },
      BASE: { dr: 'drOFR', cr: 'crOFR' },
    } as const;

    // Column maps for base amounts (used by S, RVR, RTN, SR)
    const baseColMap = {
      USD: { dr: 'drUSD', cr: 'crUSD' },
      LL: { dr: 'drLL', cr: 'crLL' },
      EURO: { dr: 'dr', cr: 'cr' },
      BASE: { dr: 'dr', cr: 'cr' },
    } as const;

    type RowKind = 'S' | 'G';

    const getColsFor = (rowKind: RowKind) => {
      if (rowKind === 'G') {
        const p = ofrColMap[currencyCode] ?? ofrColMap.USD;
        return {
          drCol: p.dr as keyof JournalVoucherDetail,
          crCol: p.cr as keyof JournalVoucherDetail,
        };
      }
      const p = baseColMap[currencyCode] ?? baseColMap.USD;
      return {
        drCol: p.dr as keyof JournalVoucherDetail,
        crCol: p.cr as keyof JournalVoucherDetail,
      };
    };

    // Determine which columns to use based on jvType
    const getRowKindFromJV = (jvType?: string | null): RowKind => {
      const t = String(jvType ?? '').trim().toUpperCase();
      if (t === 'G') return 'G'; // Offers use OFR columns
      return 'S'; // S, RVR, RTN, SR use base columns
    };

    // Query all transactions up to toDate
    const qb = this.journalVoucherDetailRepository
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.journalVoucher', 'jv')
      .where('d.customerId = :customerId', { customerId })
      .andWhere('jv.date < :toNext', { toNext }); // exclusive end

    applyTypeFilter(qb);

    const rows = await qb.getMany();

    // Calculate balance
    let totalDr = 0;
    let totalCr = 0;

    for (const r of rows) {
      const rowKind = getRowKindFromJV(r.journalVoucher?.jvType ?? null);
      const { drCol, crCol } = getColsFor(rowKind);

      totalDr += Number((r as any)[drCol] || 0);
      totalCr += Number((r as any)[crCol] || 0);
    }

    const balance = totalDr - totalCr;
    const roundedBalance = Math.round(balance * 100) / 100; // round to 2 decimals

    // Apply minBalance filter if provided
    const meetsBalanceFilter = minBalance === undefined || roundedBalance >= minBalance;

    // Only include customers with non-zero balance or transactions AND meets balance filter
    if ((rows.length > 0 || balance !== 0) && meetsBalanceFilter) {
      results.push({
        customerId,
        customerName: (customer as any).customerName || '',
        customerAccountNumber,
        currencyCode,
        balance: roundedBalance,
        transactionCount: rows.length,
      });
    }
  }

  // ✅ Sort by account number (smallest to greatest)
  results.sort((a, b) => {
    const accA = a.customerAccountNumber || '';
    const accB = b.customerAccountNumber || '';
    
    // Try to parse as numbers for proper numeric sorting
    const numA = parseInt(accA, 10);
    const numB = parseInt(accB, 10);
    
    // If both are valid numbers, compare numerically
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    
    // Otherwise, fall back to string comparison
    return accA.localeCompare(accB, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    reportDate: toDate,
    type,
    minBalance, // Include in response so frontend knows what filter was applied
    customers: results,
    summary: {
      totalCustomers: results.length,
      totalPositiveBalances: results.filter((c) => c.balance > 0).length,
      totalNegativeBalances: results.filter((c) => c.balance < 0).length,
    },
  };
}


async getAccountStatementOFR(params: {
  accountId?: number;
  customerId?: number;
  supplierId?: number;
  type?: 'S' | 'G' | 'ALL';
  from?: string;
  to?: string;
}) {
  const { accountId, customerId, supplierId, type = 'ALL', from, to } = params;

  // ✅ pick exactly one target
  const targets = [
    accountId != null ? 'account' : null,
    customerId != null ? 'customer' : null,
    supplierId != null ? 'supplier' : null,
  ].filter(Boolean);

  if (targets.length !== 1) {
    throw new BadRequestException('Provide exactly one of: accountId, customerId, supplierId');
  }

  // 1) Load metadata based on target
  let meta: any = {};
  if (accountId != null) {
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
      relations: ['currency'],
    });
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);

    meta = {
      targetKind: 'account',
      targetId: accountId,
      accountCode: (account as any).accountNumber,
      accountName: (account as any).accountName ?? (account as any).arabicAccountName,
    };
  } else if (customerId != null) {
const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    meta = {
      targetKind: 'customer',
      targetId: customerId,
      accountCode: customer.customerAccountNumber,
      accountName: customer.customerName,
    };
  } else if (supplierId != null) {
const supplier = await this.supplierRepo.findOne({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException(`Supplier ${supplierId} not found`);

    meta = {
      targetKind: 'supplier',
      targetId: supplierId,
      accountCode: supplier.supplierAccountNumber,
      accountName: supplier.supplierName,
    };
  }

  // Helper: normalize jvType -> 'S' | 'G'
  const rowKind = (r: JournalVoucherDetail): 'S' | 'G' => {
    const t = (r.journalVoucher?.jvType ?? '').trim().toUpperCase();
    return t === 'G' ? 'G' : 'S';
  };

  // Pick numbers based on jvType
  const amounts = (r: JournalVoucherDetail) => {
    const kind = rowKind(r);
    if (kind === 'G') {
      const debit  = Number(r.drUSDOFR || 0);
      const credit = Number(r.crUSDOFR || 0);
      return { kind, debit, credit };
    }
    const debit  = Number(r.drUSD || 0);
    const credit = Number(r.crUSD || 0);
    return { kind, debit, credit };
  };

  // ✅ build base WHERE depending on target kind
  const applyTargetWhere = (qb: any) => {
    if (accountId != null) qb.where('d.accountId = :id', { id: accountId });
    if (customerId != null) qb.where('d.customerId = :id', { id: customerId });
    if (supplierId != null) qb.where('d.supplierId = :id', { id: supplierId });
    return qb;
  };

  // 2) Period query
  const qb = applyTargetWhere(
    this.journalVoucherDetailRepository
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.journalVoucher', 'jv'),
  );

  if (from) qb.andWhere('jv.date >= :from', { from });
  if (to)   qb.andWhere('jv.date <= :to',   { to });

  if (type === 'S') qb.andWhere('jv.jvType = :tt', { tt: 'S' });
  if (type === 'G') qb.andWhere('jv.jvType = :tt', { tt: 'G' });

  qb.orderBy('jv.date', 'ASC').addOrderBy('d.id', 'ASC');
  const periodRows = await qb.getMany();

  // 3) Opening balance (before "from")
  let openingBalance = 0;
  if (from) {
    const beforeQb = applyTargetWhere(
      this.journalVoucherDetailRepository
        .createQueryBuilder('d')
        .leftJoin('d.journalVoucher', 'jv'),
    ).andWhere('jv.date < :from', { from });

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

  // 4) Items + running
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
      kind,
      debit,
      credit,
      balanceAfter: running,
      exRateUSD: r.exRateUSD ?? undefined,
      exRateEUROToUSD: r.exRateEUROToUSD ?? undefined,
    };
  });

  const totals = items.reduce(
    (t, it) => {
      t.totalDebit += it.debit;
      t.totalCredit += it.credit;
      return t;
    },
    { totalDebit: 0, totalCredit: 0 },
  );

  return {
    ...meta,
    from: from ?? null,
    to: to ?? null,
    openingBalance,
    totals,
    closingBalance: running,
    items,
    basis: {
      selection: type,
      columnBasis: {
        S: { debit: 'drUSD', credit: 'crUSD' },
        G: { debit: 'drUSDOFR', credit: 'crUSDOFR' },
      },
    },
  };
}




private static readonly TRAILING_DIGITS_EXPR =
    `substring(jv."jvNumber" from '([0-9]+)$')`;




async searchBySeq(params?: {
  seq?: string;
  q?: string; // ✅ NEW: customer/supplier/account search
  page?: number;
  limit?: number;
  type?: string; // 'INVOICE'|'RECEIVABLE'|'JV' OR Arabic
}): Promise<{
  data: {
    id: number;
    date: Date;
    jvNumber: string;
    jvType: string;
    description: string;

    name: string;
    kind: "INVOICE" | "RECEIVABLE" | "PURCHASE" | "JV";
    customerName?: string | null;
    invoiceNumber?: string | null;
    invoiceId?: number | null;
    receiptCurrency?: string | null;
  }[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}> {
  const page = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 100)));

  const seqDigits = (params?.seq ?? "").replace(/\D+/g, "");
  const seqExpr = "REGEXP_SUBSTR(jv.jvNumber, '[0-9]+$')";

  // ✅ normalize type filter (Arabic/English)
  const rawType = (params?.type ?? "").trim();
  const normType = (() => {
    if (!rawType) return "";
    const t = rawType.toUpperCase();

    if (t === "INVOICE") return "INVOICE";
    if (t === "RECEIVABLE") return "RECEIVABLE";
    if (t === "JV") return "JV";
    if (t === "PURCHASE") return "PURCHASE";

    // Arabic mapping
    if (rawType.includes("فات")) return "INVOICE";
    if (rawType.includes("دف")) return "RECEIVABLE";
    if (rawType.includes("قيد")) return "JV";

    return t;
  })();

  const applyJoins = (qb: SelectQueryBuilder<JournalVoucher>) => {
    return qb
      // Details
      .leftJoin(JournalVoucherDetail, "d", "d.journalVoucherId = jv.id")

      // ✅ Account join (so we can search accountName/accountNumber)
      .leftJoin("accounts", "acc", "acc.id = d.accountId")

      // Receivable
      .leftJoin(ReceiptEntry, "re", "re.journalVoucherId = jv.id")
      .leftJoin("customers", "rcust", "rcust.id = re.customerId")

      // Receipt -> Invoice (sales)
      .leftJoin("invoices", "sinv", "sinv.id = re.invoiceId")
      .leftJoin("customers", "sinvCust", "sinvCust.id = sinv.customerId")

      // Purchase invoice
      .leftJoin(PurchaseInvoice, "pinv", "pinv.id = jv.purchaseInvoiceId")
      .leftJoin(Supplier, "psup", "psup.id = pinv.supplierId")

      // DocNbr -> Invoice (fixes G / RTN / RVR)
      .leftJoin("invoices", "dinv", "dinv.invoiceNumber = d.docNbr")
      .leftJoin("customers", "dinvCust", "dinvCust.id = dinv.customerId");
  };

  const applySeqFilter = (qb: SelectQueryBuilder<JournalVoucher>) => {
    if (!seqDigits) return;
    qb.andWhere(
      `(${seqExpr}) = :seq OR CAST((${seqExpr}) AS UNSIGNED) = :seqNum`,
      { seq: seqDigits, seqNum: Number(seqDigits) }
    );
  };

  // ✅ NEW: text filter (customer/supplier/account)
  const applyTextFilter = (qb: SelectQueryBuilder<JournalVoucher>) => {
    const raw = (params?.q ?? "").trim();
    if (!raw) return;

    const q = raw.replace(/\s+/g, " ");
    const like = `%${q}%`;
    const digits = q.replace(/\D+/g, "");

    qb.andWhere(
      new Brackets((w) => {
        // customers (receipt + invoice)
        w.where("rcust.customerName LIKE :like", { like })
          .orWhere("sinvCust.customerName LIKE :like", { like })
          .orWhere("dinvCust.customerName LIKE :like", { like })

          // supplier
          .orWhere("psup.supplierName LIKE :like", { like })

          // account
          .orWhere("acc.accountName LIKE :like", { like })
          .orWhere("acc.accountNumber LIKE :like", { like });

        // optional exact account number match if digits exist
        if (digits) {
          w.orWhere("acc.accountNumber = :accNum", { accNum: digits });
        }
      })
    );
  };

  // ✅ Type filter
  const applyTypeFilter = (qb: SelectQueryBuilder<JournalVoucher>) => {
    if (!normType) return;

    if (normType === "INVOICE") {
      qb.andWhere(
        new Brackets((w) => {
          w.where("sinv.id IS NOT NULL")
            .orWhere("dinv.id IS NOT NULL")
            .orWhere("pinv.id IS NOT NULL");
        })
      );
      return;
    }

    if (normType === "RECEIVABLE") {
      qb.andWhere("re.id IS NOT NULL")
        .andWhere("sinv.id IS NULL")
        .andWhere("dinv.id IS NULL")
        .andWhere("pinv.id IS NULL");
      return;
    }

    if (normType === "JV") {
      qb.andWhere("re.id IS NULL")
        .andWhere("sinv.id IS NULL")
        .andWhere("dinv.id IS NULL")
        .andWhere("pinv.id IS NULL");
      return;
    }

    if (normType === "PURCHASE") {
      qb.andWhere("pinv.id IS NOT NULL");
      return;
    }
  };

  // -----------------------------
  // 1) COUNT
  // -----------------------------
  const countQb = applyJoins(this.journalVoucherRepository.createQueryBuilder("jv"));
  applySeqFilter(countQb);
  applyTextFilter(countQb);   // ✅ NEW
  applyTypeFilter(countQb);

  const countRow = await countQb
    .select("COUNT(DISTINCT jv.id)", "cnt")
    .getRawOne();

  const total = Number(countRow?.cnt || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = page < totalPages;

  if (total === 0) {
    return { data: [], page, limit, total, totalPages, hasMore: false };
  }

  // -----------------------------
  // 2) PAGE OF IDS
  // -----------------------------
  const idQb = applyJoins(this.journalVoucherRepository.createQueryBuilder("jv"))
    .select("jv.id", "id");

  applySeqFilter(idQb);
  applyTextFilter(idQb);      // ✅ NEW
  applyTypeFilter(idQb);

  const idRows = await idQb
    .groupBy("jv.id")
    .orderBy("jv.date", "DESC")
    .addOrderBy("jv.id", "DESC")
    .skip((page - 1) * limit)
    .take(limit)
    .getRawMany();

  const ids = (idRows || []).map((r: any) => Number(r.id)).filter(Boolean);
  if (ids.length === 0) {
    return { data: [], page, limit, total, totalPages, hasMore };
  }

  // -----------------------------
  // 3) FETCH FIELDS FOR THOSE IDS
  // -----------------------------
  const rows = await applyJoins(this.journalVoucherRepository.createQueryBuilder("jv"))
    .select("jv.id", "id")
    .addSelect("jv.date", "date")
    .addSelect("jv.jvNumber", "jvNumber")
    .addSelect("jv.jvType", "jvType")
    .addSelect("MIN(CASE WHEN d.dr > 0 THEN d.description END)", "description")

    // receivable
    .addSelect("MAX(re.id)", "receiptEntryId")
    .addSelect("MAX(re.currency)", "receiptCurrency")
    .addSelect("MAX(rcust.customerName)", "receiptCustomerName")

    // receipt->invoice
    .addSelect("MAX(sinv.id)", "receiptInvoiceId")
    .addSelect("MAX(sinv.invoiceNumber)", "receiptInvoiceNumber")
    .addSelect("MAX(sinv.invoiceType)", "receiptInvoiceType")
    .addSelect("MAX(sinvCust.customerName)", "receiptInvoiceCustomerName")

    // docNbr->invoice
    .addSelect("MAX(dinv.id)", "docInvoiceId")
    .addSelect("MAX(dinv.invoiceNumber)", "docInvoiceNumber")
    .addSelect("MAX(dinv.invoiceType)", "docInvoiceType")
    .addSelect("MAX(dinvCust.customerName)", "docInvoiceCustomerName")

    // purchase
    .addSelect("MAX(pinv.id)", "purchaseInvoiceId")
    .addSelect("MAX(pinv.invoiceNumber)", "purchaseInvoiceNumber")
    .addSelect("MAX(psup.supplierName)", "purchaseSupplierName")

    .where("jv.id IN (:...ids)", { ids })
    .groupBy("jv.id")
    .addGroupBy("jv.date")
    .addGroupBy("jv.jvNumber")
    .addGroupBy("jv.jvType")
    .orderBy("jv.date", "DESC")
    .addOrderBy("jv.id", "DESC")
    .getRawMany();

  // -----------------------------
  // 4) Normalize + build label
  // -----------------------------
  const data = (rows || []).map((r: any) => {
    const receiptEntryId = r.receiptEntryId != null ? Number(r.receiptEntryId) : null;

    const receiptInvoiceId = r.receiptInvoiceId != null ? Number(r.receiptInvoiceId) : null;
    const docInvoiceId = r.docInvoiceId != null ? Number(r.docInvoiceId) : null;
    const purchaseInvoiceId = r.purchaseInvoiceId != null ? Number(r.purchaseInvoiceId) : null;

    // invoice priority: receipt invoice -> docNbr invoice -> purchase invoice
    const invoiceId = receiptInvoiceId ?? docInvoiceId ?? purchaseInvoiceId ?? null;
    const invoiceNumber =
      r.receiptInvoiceNumber ?? r.docInvoiceNumber ?? r.purchaseInvoiceNumber ?? null;
    const invoiceType = r.receiptInvoiceType ?? r.docInvoiceType ?? null;

    const invoiceCustomerName =
      r.receiptInvoiceCustomerName ?? r.docInvoiceCustomerName ?? null;

    let kind: "INVOICE" | "RECEIVABLE" | "PURCHASE" | "JV" = "JV";
    let name = `قيد يومية - ${r.jvNumber}`.trim();
    let customerName: string | null = null;

    if (invoiceId && invoiceNumber) {
      // INVOICE or PURCHASE
      if (purchaseInvoiceId && !receiptInvoiceId && !docInvoiceId) {
        kind = "PURCHASE";
        customerName = r.purchaseSupplierName ?? null;
        name = `فاتورة شراء - ${customerName ?? ""} - ${invoiceNumber}`.trim();
      } else {
        kind = "INVOICE";
        customerName = invoiceCustomerName ?? null;

        if (invoiceType === "RTN") {
          name = `مرتجع - ${customerName ?? ""} - ${invoiceNumber}`.trim();
        } else {
          const tag = invoiceType ? ` ${invoiceType}` : "";
          name = `فاتورة${tag} - ${customerName ?? ""} - ${invoiceNumber}`.trim();
        }
      }
    } else if (receiptEntryId) {
      kind = "RECEIVABLE";
      customerName = r.receiptCustomerName ?? null;

      const cur = String(r.receiptCurrency ?? "").toUpperCase();
      const payTag = cur === "USD" ? "دفعة $$" : cur === "LL" ? "دفعة LL" : "دفعة";
      name = `${payTag} - ${customerName ?? ""} - ${r.jvNumber}`.trim();
    } else {
      kind = "JV";
      name = `قيد يومية - ${r.jvNumber}`.trim();
    }

    return {
      id: Number(r.id),
      date: r.date,
      jvNumber: r.jvNumber,
      jvType: r.jvType,
      description: r.description ?? "No Description",

      name,
      kind,
      customerName,
      invoiceNumber,
      invoiceId,
      receiptCurrency: r.receiptCurrency ?? null,
    };
  });

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






async searchByCustomerOrJv(params?: {
  q?: string;
  page?: number;
  limit?: number; // hard-cap 100
}): Promise<{
  data: { id: number; date: Date; jvNumber: string; jvType: string; description: string }[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}> {
  const page = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 50)));
  const rawQ = (params?.q ?? "").trim();

  if (!rawQ) {
    return this.getVoucherSummary({ page, limit });
  }

  const qLower = rawQ.toLowerCase();
  const like = `%${qLower}%`;

  // ✅ Works in MySQL + Postgres
  const custNameExpr = `LOWER(COALESCE(c.customerName, ''))`;
  const fullNameExpr = `LOWER(CONCAT_WS(' ', COALESCE(c.firstName,''), COALESCE(c.middleName,''), COALESCE(c.lastName,'')))`;
  const fullNameRevExpr = `LOWER(CONCAT_WS(' ', COALESCE(c.lastName,''), COALESCE(c.firstName,''), COALESCE(c.middleName,'')))`;

  // Reuse the same WHERE for count + ids
  const applySearch = (qb: any) => {
    qb.where(
      new Brackets((w) => {
        w.where("LOWER(jv.jvNumber) LIKE :like", { like })
          // ✅ original customerName
          .orWhere(`${custNameExpr} LIKE :like`, { like })
          // ✅ first/middle/last
          .orWhere(`${fullNameExpr} LIKE :like`, { like })
          // ✅ reversed order: "last first"
          .orWhere(`${fullNameRevExpr} LIKE :like`, { like });
      }),
    );
  };

  // -------- 1) COUNT DISTINCT JV IDs --------
  const countQb = this.journalVoucherRepository
    .createQueryBuilder("jv")
    .leftJoin("jv.details", "d")
    .leftJoin("d.customer", "c");

  applySearch(countQb);

  const { cnt } = await countQb
    .select("COUNT(DISTINCT jv.id)", "cnt")
    .getRawOne<{ cnt: string }>();

  const total = Number(cnt || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = page < totalPages;

  if (total === 0) {
    return { data: [], page, limit, total, totalPages, hasMore: false };
  }

  // -------- 2) PAGE OF JV IDs --------
  const idQb = this.journalVoucherRepository
    .createQueryBuilder("jv")
    .leftJoin("jv.details", "d")
    .leftJoin("d.customer", "c")
    .select("jv.id", "id");

  applySearch(idQb);

  const idRows = await idQb
    .groupBy("jv.id")
    .orderBy("jv.date", "DESC")
    .addOrderBy("jv.id", "DESC")
    .offset((page - 1) * limit)
    .limit(limit)
    .getRawMany<{ id: number }>();

  const ids = idRows.map((r) => Number(r.id));
  if (ids.length === 0) {
    return { data: [], page, limit, total, totalPages, hasMore };
  }

  // -------- 3) HYDRATE FIELDS FOR THOSE IDS --------
  const rows = await this.journalVoucherRepository
    .createQueryBuilder("jv")
    .leftJoin("jv.details", "d")
    .leftJoin("d.customer", "c")
    .select([
      "jv.id AS id",
      "jv.date AS date",
      'jv.jvNumber AS "jvNumber"',
      'jv.jvType AS "jvType"',
    ])
    .addSelect(
      "MIN(CASE WHEN d.dr > 0 THEN d.description END)",
      "description",
    )
    .where("jv.id IN (:...ids)", { ids })
    .groupBy("jv.id")
    .addGroupBy("jv.date")
    .addGroupBy("jv.jvNumber")
    .addGroupBy("jv.jvType")
    .orderBy("jv.date", "DESC")
    .addOrderBy("jv.id", "DESC")
    .getRawMany<{
      id: number;
      date: Date;
      jvNumber: string;
      jvType: string;
      description: string | null;
    }>();

  const data = rows.map((r) => ({
    id: Number(r.id),
    date: r.date,
    jvNumber: r.jvNumber,
    jvType: r.jvType,
    description: r.description ?? "No Description",
  }));

  return { data, page, limit, total, totalPages, hasMore };
}


}
