// src/receipt-voucher/recievables.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ReceiptEntry } from '../entities/recievables.entities';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Customer } from '../entities/customer.entity';
import { Account } from '../entities/account.entity';
import { Settings } from '../entities/settings.entity';
import { RecievablesGateway } from './recievables.broadcast';
import { Sequence } from 'mysql2/typings/mysql/lib/protocol/sequences/Sequence';
import { Currency } from '../entities/currency.entity';
import { Invoice } from '../entities/invoice.entity';
import { AccountingResolverService } from '../accountRoleMap/accounting-resolver.service';
import { computeDiff } from '../common/compute-diff';

type ReceiptType = 'G' | 'S' | 'RVR';

@Injectable()
export class RecievablesService {
  constructor(
    @InjectRepository(ReceiptEntry)
    private readonly entryRepo: Repository<ReceiptEntry>,

    @InjectRepository(JournalVoucher)
    private readonly jvRepo: Repository<JournalVoucher>,

    @InjectRepository(JournalVoucherDetail)
    private readonly jvDetailRepo: Repository<JournalVoucherDetail>,

    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,
     @InjectRepository(Currency)
  private readonly currencyRepo: Repository<Currency>,

     @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,

    private readonly gateway: RecievablesGateway,
     private readonly accountingResolver: AccountingResolverService,
     
  ) {}


private normalizeCurrencyCode(raw: string): 'USD' | 'LL' | 'EURO' | string {
  const s = (raw || '').trim().toUpperCase();
  if (s === 'US$' || s === '$') return 'USD';
  if (s === 'LBP' || s === 'LIRA' || s === 'L.L' || s === 'L£') return 'LL';
  if (s === 'EUR') return 'EURO';
  return s; // already USD / LL / EURO, or any other code you allow
}


async create(data: {
  customerId: number;
  date: Date;
  invoiceId?: number | null;
  cashNumber: number;
  currency: 'USD' | 'LL';
  exchangeRate?: number;
  amountExchanged: number;
  comments?: string;
  type: ReceiptType;
  pmtType: 'Cash' | 'Check';
}): Promise<ReceiptEntry> {
  // 1) Active year
  const setting = await this.settingsRepo.findOne({
    where: { isActive: true },
  });
  if (!setting) throw new NotFoundException('No active financial year set');
  const yy = setting.year.slice(-2);
  
  // 2) Choose prefix: 'RVG' for G, else 'RV'
  const prefix = data.type === 'G' ? 'RVG' : 'RV';

  // 3) New JV number — order by id DESC to avoid alphabetic sort breaking at 1000+
  const lastJv = await this.jvRepo.find({
    where: { jvNumber: Like(`${prefix}${yy}-%`) },
    order: { id: 'DESC' },
    take: 1,
  });
  const seq = lastJv.length
    ? parseInt(lastJv[0].jvNumber.split('-')[1], 10) + 1
    : 1;
  const jvNumber = `${prefix}${yy}-${String(seq).padStart(3, '0')}`;

  // 4) Determine USD/LL parts
  const usdPart =
    data.currency === 'LL' ? data.amountExchanged : data.cashNumber;
  const llPart =
    data.currency === 'LL' ? data.cashNumber : data.amountExchanged;

  // 5) Compute header totals by type
  let hdrDr = 0,
    hdrDrUSD = 0,
    hdrDrLL = 0;
  let hdrDrOFR = 0,
    hdrDrUSDOFR = 0,
    hdrDrLLOFR = 0;
  let hdrCr = 0,
    hdrCrUSD = 0,
    hdrCrLL = 0;
  let hdrCrOFR = 0,
    hdrCrUSDOFR = 0,
    hdrCrLLOFR = 0;

  switch (data.type) {
    case 'G':
      hdrDrOFR = usdPart;
      hdrDrUSDOFR = usdPart;
      hdrDrLLOFR = llPart;
      hdrCrOFR = usdPart;
      hdrCrUSDOFR = usdPart;
      hdrCrLLOFR = llPart;
      break;
    case 'S':
      hdrDr = usdPart;
      hdrDrUSD = usdPart;
      hdrDrLL = llPart;
      hdrDrOFR = usdPart;
      hdrDrUSDOFR = usdPart;
      hdrDrLLOFR = llPart;
      hdrCr = usdPart;
      hdrCrUSD = usdPart;
      hdrCrLL = llPart;
      hdrCrOFR = usdPart;
      hdrCrUSDOFR = usdPart;
      hdrCrLLOFR = llPart;
      break;
    case 'RVR':
      hdrDr = usdPart;
      hdrDrUSD = usdPart;
      hdrDrLL = llPart;
      hdrCr = usdPart;
      hdrCrUSD = usdPart;
      hdrCrLL = llPart;
      break;
  }

  // 6) Persist JV header
  const jv = this.jvRepo.create({
    date: data.date,
    jvNumber,
    jvType: data.type,
    totalDr: hdrDr,
    totalDrUSD: hdrDrUSD,
    totalDrLL: hdrDrLL,
    totalDrOFR: hdrDrOFR,
    totalDrUSDOFR: hdrDrUSDOFR,
    totalDrLLOFR: hdrDrLLOFR,
    totalCr: hdrCr,
    totalCrUSD: hdrCrUSD,
    totalCrLL: hdrCrLL,
    totalCrOFR: hdrCrOFR,
    totalCrUSDOFR: hdrCrUSDOFR,
    totalCrLLOFR: hdrCrLLOFR,
  });
  await this.jvRepo.save(jv);

  // 7) Create JV detail lines
const cashRole = data.currency === 'USD' ? 'Cash_USD' : 'Cash_LL';
const cashAcct = await this.accountingResolver.resolveAccount(cashRole, null);

if (!cashAcct) throw new NotFoundException(`Cash role ${cashRole} not mapped to an account`);


  // ✅ FIXED: Build description with static text + comments in parentheses
  let descriptionText: string | null = null;
  
  if (data.pmtType === 'Cash') {
    // Static part based on currency
    const staticDesc = data.currency === 'USD' ? 'دفعة نقدا $$' : 'دفعة نقدا LL';
    
    // Add comments in parentheses if provided
    if (data.comments && data.comments.trim()) {
      descriptionText = `${staticDesc} (${data.comments.trim()})`;
    } else {
      descriptionText = staticDesc;
    }
  } else {
    // For Check payments, just use comments if provided
    descriptionText = data.comments?.trim() || null;
  }

  const currencyCode = this.normalizeCurrencyCode(data.currency);
  const exRateUSD = Number(data.exchangeRate);                        
  const exRateEUROToUSD = currencyCode === 'EURO' ? exRateUSD : 0;

  const drLine = this.jvDetailRepo.create({
    journalVoucherId: jv.id,
    accountId: cashAcct.id,
    currency: currencyCode, 
    dr: hdrDr,
    drUSD: hdrDrUSD,
    drLL: hdrDrLL,
    drOFR: hdrDrOFR,
    drUSDOFR: hdrDrUSDOFR,
    drLLOFR: hdrDrLLOFR,
    cr: 0,
    crUSD: 0,
    crLL: 0,
    crOFR: 0,
    crUSDOFR: 0,
    crLLOFR: 0,
    exRateUSD,
    exRateEUROToUSD,
    description: descriptionText, // ✅ Now includes static + comments
    docNbr: jvNumber,
  });

  const crLine = this.jvDetailRepo.create({
    journalVoucherId: jv.id,
    customerId: data.customerId,
    currency: currencyCode,
    dr: 0,
    drUSD: 0,
    drLL: 0,
    drOFR: 0,
    drUSDOFR: 0,
    drLLOFR: 0,
    cr: hdrCr,
    crUSD: hdrCrUSD,
    crLL: hdrCrLL,
    crOFR: hdrCrOFR,
    crUSDOFR: hdrCrUSDOFR,
    crLLOFR: hdrCrLLOFR,
    exRateUSD,
    exRateEUROToUSD,
    description: descriptionText, // ✅ Now includes static + comments
    docNbr: jvNumber,
  });

  await this.jvDetailRepo.save([drLine, crLine]);

  // 8) Persist ReceiptEntry
  const entry = this.entryRepo.create({
    customerId: data.customerId,
    date: data.date,
    invoiceId: data.invoiceId,
    cashNumber: data.cashNumber,
    currency: data.currency,
    exchangeRate: data.exchangeRate ?? null,
    amountExchanged: data.amountExchanged,
    comments: data.comments ?? null,
    type: data.type,
    journalVoucherId: jv.id,
    pmtType: data.pmtType,
  });

  const savedEntry = await this.entryRepo.save(entry);
  jv.receiptEntryId = savedEntry.id;
  await this.jvRepo.save(jv);

  // 9) Broadcast the updated list
  const all = await this.findSummary();
  this.gateway.broadcastAll(all);

  return { ...savedEntry, jvNumber: jv.jvNumber } as any;
}


  private mapEntry(e: ReceiptEntry) {
    return {
      id: e.id,
      customerid: e.customerId,
      customerName: e.customer.customerName,
      currency: e.currency,
      exchangeRate: e.exchangeRate,
      amountExchanged: e.amountExchanged,
      cashNumber: e.cashNumber,
      date: e.date,
      jvNumber: e.journalVoucher.jvNumber,
      comments: e.comments,
      pmtType: e.pmtType,
      invoiceId: e.invoiceId,
      type: e.type,
    };
  }

  async findSummary() {
    const entries = await this.entryRepo.find({
      relations: ['customer', 'journalVoucher'],
      order: { id: 'DESC' },
    });
    return entries.map((e) => this.mapEntry(e));
  }

  async findSummaryPaginated(
    limit: number,
    offset: number,
    filters?: {
      customer?: string;
      cashNumber?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const qb = this.entryRepo
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.customer', 'customer')
      .leftJoinAndSelect('entry.journalVoucher', 'jv')
      .orderBy('entry.id', 'DESC')
      .take(limit)
      .skip(offset);

    if (filters?.customer) {
      qb.andWhere('customer.customerName LIKE :customer', {
        customer: `%${filters.customer}%`,
      });
    }
    if (filters?.cashNumber) {
      qb.andWhere('CAST(entry.cashNumber AS CHAR) LIKE :cashNumber', {
        cashNumber: `%${filters.cashNumber}%`,
      });
    }
    if (filters?.dateFrom) {
      qb.andWhere('entry.date >= :dateFrom', { dateFrom: filters.dateFrom });
    }
    if (filters?.dateTo) {
      qb.andWhere('entry.date <= :dateTo', { dateTo: filters.dateTo });
    }

    const [entries, total] = await qb.getManyAndCount();
    return { data: entries.map((e) => this.mapEntry(e)), total };
  }
  /*update an existing reciept + its jv */
  async update(
  id: number,
  data: {
    customerId: number;
    date: Date;
    invoiceId?: number | null;
    cashNumber: number;
    currency: 'USD' | 'LL';
    exchangeRate?: number;
    amountExchanged: number;
    comments?: string;
    type: ReceiptType;
    pmtType: 'Cash' | 'Check';
  },
): Promise<ReceiptEntry> {
  // fetch the existing entry + its JV+details
  const entry = await this.entryRepo.findOne({
    where: { id },
    relations: ['journalVoucher', 'journalVoucher.details'],
  });
  if (!entry) throw new NotFoundException('Receipt entry not found');

  const RECEIVABLE_FIELDS = ['customerId', 'date', 'cashNumber', 'currency', 'exchangeRate', 'amountExchanged', 'comments', 'type', 'pmtType'];
  const oldSnapshot = {} as Record<string, any>;
  for (const f of RECEIVABLE_FIELDS) oldSnapshot[f] = (entry as any)[f] ?? null;

  const jv = entry.journalVoucher;

  // recalc your JV‐number *only* if type changed (else keep the old one)
  if (data.type !== entry.type) {
    const yy = (
      await this.settingsRepo.findOne({ where: { isActive: true } })
    ).year.slice(-2);
    const prefix = data.type === 'G' ? 'RVG' : 'RV';
    const last = await this.jvRepo.find({
      where: { jvNumber: Like(`${prefix}${yy}-%`) },
      order: { id: 'DESC' },
      take: 1,
    });
    const seq = last.length
      ? parseInt(last[0].jvNumber.split('-')[1], 10) + 1
      : 1;
    jv.jvNumber = `${prefix}${yy}-${String(seq).padStart(3, '0')}`;
  }

  // update header date/type
  jv.date = data.date;
  jv.jvType = data.type;

  // compute the USD/LL parts and totals just like in create()
  const usdPart =
    data.currency === 'LL' ? data.amountExchanged : data.cashNumber;
  const llPart =
    data.currency === 'LL' ? data.cashNumber : data.amountExchanged;

  const normalizedCode = this.normalizeCurrencyCode(data.currency);
  const exRateUSD = Number(data.exchangeRate);
  const exRateEUROToUSD = normalizedCode === 'EURO' ? exRateUSD : 0;

  // ✅ FIXED: Build description with static text + comments in parentheses
  let descriptionText: string | null = null;
  
  if (data.pmtType === 'Cash') {
    // Static part based on currency
    const staticDesc = normalizedCode === 'USD' ? 'دفعة نقدا $$' : 'دفعة نقدا LL';
    
    // Add comments in parentheses if provided
    if (data.comments && data.comments.trim()) {
      descriptionText = `${staticDesc} (${data.comments.trim()})`;
    } else {
      descriptionText = staticDesc;
    }
  } else {
    // For Check payments, just use comments if provided
    descriptionText = data.comments?.trim() || null;
  }

  let hdrDr = 0,
    hdrDrUSD = 0,
    hdrDrLL = 0;
  let hdrDrOFR = 0,
    hdrDrUSDOFR = 0,
    hdrDrLLOFR = 0;
  let hdrCr = 0,
    hdrCrUSD = 0,
    hdrCrLL = 0;
  let hdrCrOFR = 0,
    hdrCrUSDOFR = 0,
    hdrCrLLOFR = 0;

  switch (data.type) {
    case 'G':
      hdrDrOFR = usdPart;
      hdrDrUSDOFR = usdPart;
      hdrDrLLOFR = llPart;
      hdrCrOFR = usdPart;
      hdrCrUSDOFR = usdPart;
      hdrCrLLOFR = llPart;
      break;
    case 'S':
      hdrDr = usdPart;
      hdrDrUSD = usdPart;
      hdrDrLL = llPart;
      hdrDrOFR = usdPart;
      hdrDrUSDOFR = usdPart;
      hdrDrLLOFR = llPart;
      hdrCr = usdPart;
      hdrCrUSD = usdPart;
      hdrCrLL = llPart;
      hdrCrOFR = usdPart;
      hdrCrUSDOFR = usdPart;
      hdrCrLLOFR = llPart;
      break;
    case 'RVR':
      hdrDr = usdPart;
      hdrDrUSD = usdPart;
      hdrDrLL = llPart;
      hdrCr = usdPart;
      hdrCrUSD = usdPart;
      hdrCrLL = llPart;
      break;
  }

  // assign header totals & save
  Object.assign(jv, {
    totalDr: hdrDr,
    totalDrUSD: hdrDrUSD,
    totalDrLL: hdrDrLL,
    totalDrOFR: hdrDrOFR,
    totalDrUSDOFR: hdrDrUSDOFR,
    totalDrLLOFR: hdrDrLLOFR,
    totalCr: hdrCr,
    totalCrUSD: hdrCrUSD,
    totalCrLL: hdrCrLL,
    totalCrOFR: hdrCrOFR,
    totalCrUSDOFR: hdrCrUSDOFR,
    totalCrLLOFR: hdrCrLLOFR,
  });
  await this.jvRepo.save(jv);

  // drop old lines & reinsert
  await this.jvDetailRepo.delete({ journalVoucherId: jv.id });

const cashRole = data.currency === 'USD' ? 'Cash_USD' : 'Cash_LL';
const cashAcct = await this.accountingResolver.resolveAccount(cashRole, null);

if (!cashAcct) throw new NotFoundException(`Cash role ${cashRole} not mapped to an account`);


  const drLine = this.jvDetailRepo.create({
    journalVoucherId: jv.id,
    accountId: cashAcct.id,
    currency: normalizedCode,
    dr: hdrDr,
    drUSD: hdrDrUSD,
    drLL: hdrDrLL,
    drOFR: hdrDrOFR,
    drUSDOFR: hdrDrUSDOFR,
    drLLOFR: hdrDrLLOFR,
    exRateUSD,
    exRateEUROToUSD,
    cr: 0,
    crUSD: 0,
    crLL: 0,
    crOFR: 0,
    crUSDOFR: 0,
    crLLOFR: 0,
    description: descriptionText, // ✅ Now includes static + comments
    docNbr: jv.jvNumber,
  });

  const crLine = this.jvDetailRepo.create({
    journalVoucherId: jv.id,
    customerId: data.customerId,
    currency: normalizedCode,
    dr: 0,
    drUSD: 0,
    drLL: 0,
    drOFR: 0,
    drUSDOFR: 0,
    drLLOFR: 0,
    cr: hdrCr,
    crUSD: hdrCrUSD,
    crLL: hdrCrLL,
    crOFR: hdrCrOFR,
    crUSDOFR: hdrCrUSDOFR,
    crLLOFR: hdrCrLLOFR,
    description: descriptionText, // ✅ Now includes static + comments
    docNbr: jv.jvNumber,
    exRateUSD,
    exRateEUROToUSD,
  });
  await this.jvDetailRepo.save([drLine, crLine]);

  // update the ReceiptEntry itself
  Object.assign(entry, {
    customerId: data.customerId,
    date: data.date,
    invoiceId: data.invoiceId,
    cashNumber: data.cashNumber,
    currency: data.currency,
    exchangeRate: data.exchangeRate ?? null,
    amountExchanged: data.amountExchanged,
    comments: data.comments ?? null,
    type: data.type,
    pmtType: data.pmtType,
    journalVoucherId: jv.id,
  });
  const updated = await this.entryRepo.save(entry);

  // broadcast new summary
  this.gateway.broadcastAll(await this.findSummary());

  const _changes = computeDiff(oldSnapshot, updated as any, Object.keys(oldSnapshot));
  return { ...updated, jvNumber: jv.jvNumber, _changes: Object.keys(_changes).length ? _changes : undefined } as any;
}





// In RecievablesService

async delete(id: number): Promise<{ ok: true; id: number }> {
  await this.entryRepo.manager.transaction(async (mgr) => {
    const entryRepo = mgr.getRepository(ReceiptEntry);
    const jvRepo = mgr.getRepository(JournalVoucher);
    const jvDetailRepo = mgr.getRepository(JournalVoucherDetail);

    const entry = await entryRepo.findOne({
      where: { id },
      relations: ['journalVoucher'],
    });
    if (!entry) throw new NotFoundException('Receipt entry not found');

    const jvId = entry.journalVoucher?.id ?? entry.journalVoucherId ?? null;

    // If JV has a back-link to receiptEntryId, null it FIRST to avoid the reverse FK (if you have it)
    if (jvId) {
      const jv = await jvRepo.findOne({ where: { id: jvId } });
      if (jv && (jv as any).receiptEntryId != null) {
        (jv as any).receiptEntryId = null;
        await jvRepo.save(jv);
      }
    }

    // ✅ 1) Delete the child first (receipt_entries) so it no longer references the JV
    await entryRepo.delete({ id });

    // ✅ 2) Then delete JV details + JV
    if (jvId) {
      await jvDetailRepo.delete({ journalVoucherId: jvId });
      await jvRepo.delete({ id: jvId });
    }
  });

  // ✅ Broadcast updated list afterwards
  this.gateway.broadcastAll(await this.findSummary());

  return { ok: true, id };
}



 async listInvoicesForReceivablesByCustomer(params: {
    customerId: number;
    q?: string;
    type?: 'S' | 'G' | 'RVR' | 'RTN' | 'ALL';
    from?: string; // 'YYYY-MM-DD'
    to?: string;   // 'YYYY-MM-DD'
    page?: number;
    limit?: number;
  }) {
    const {
      customerId,
      q,
      type = 'ALL',
      from,
      to,
      page = 1,
      limit = 50,
    } = params;

    if (!Number.isFinite(customerId) || customerId <= 0) {
      throw new BadRequestException('Invalid customerId');
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    const qb = this.invoiceRepo
      .createQueryBuilder('inv')
      .leftJoin('inv.customer', 'c')
      .where('inv.customerId = :customerId', { customerId })
      .select([
        'inv.id AS id',
        'inv.invoiceNumber AS invoiceNumber',
        'inv.date AS date',
        'inv.totalWithoutVAT AS totalWithoutVAT',
        'inv.totalVAT AS totalVAT',
        'inv.grandTotal AS grandTotal',
        'inv.invoiceType AS invoiceType',
        'inv.customerId AS customerId',
      ])
      // change to c.name if your column is `name`
      .addSelect('c.customerName', 'customerName')
      .orderBy('inv.date', 'DESC')
      .addOrderBy('inv.id', 'DESC');

    if (type !== 'ALL') qb.andWhere('inv.invoiceType = :type', { type });
    if (from) qb.andWhere('inv.date >= :from', { from });
    if (to) qb.andWhere('inv.date <= :to', { to });

    const term = (q || '').trim();
    if (term) {
      qb.andWhere('(inv.invoiceNumber LIKE :term)', { term: `%${term}%` });
      // (customer filter already applied, so name search usually unnecessary)
    }

    const total = await qb.getCount();

    const rows = await qb.offset(skip).limit(safeLimit).getRawMany();

    const data = rows.map((r: any) => ({
      id: Number(r.id),
      invoiceNumber: r.invoiceNumber ?? null,
      customerId: Number(r.customerId),
      customerName: r.customerName ?? null,
      date: r.date, // DATE column -> usually 'YYYY-MM-DD'
      totalWithoutVAT: Number(r.totalWithoutVAT ?? 0),
      totalVAT: Number(r.totalVAT ?? 0),
      grandTotal: Number(r.grandTotal ?? 0),
      invoiceType: r.invoiceType ?? null,
    }));

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }


async getJournalVoucherForReceiptEntry(receiptEntryId: number) {
  // First verify the receipt entry exists
  const receiptEntry = await this.entryRepo.findOne({
    where: { id: receiptEntryId },
    relations: ['customer', 'journalVoucher'],
  });

  if (!receiptEntry) {
    throw new NotFoundException(
      `Receipt entry with ID ${receiptEntryId} not found`,
    );
  }

  // Get the journal voucher ID
  const jvId = receiptEntry.journalVoucherId;

  if (!jvId) {
    throw new NotFoundException(
      `No journal voucher found for receipt entry ${receiptEntryId}`,
    );
  }

  // Get the full journal voucher with details
  const journalVoucher = await this.jvRepo.findOne({
    where: { id: jvId },
    relations: [
      'details',
      'details.account',
      'details.supplier',
      'details.customer',
      'details.exchangeRateAcc',
      'details.exchangeRateUSD',
      'exchangeRateAcc',
      'exchangeRateUSD',
    ],
  });

  if (!journalVoucher) {
    throw new NotFoundException(
      `Journal voucher with ID ${jvId} not found`,
    );
  }

  return {
    receiptEntry: {
      id: receiptEntry.id,
      customerId: receiptEntry.customerId,
      customerName: receiptEntry.customer?.customerName,
      type: receiptEntry.type,
      date: receiptEntry.date,
      cashNumber: receiptEntry.cashNumber,
      currency: receiptEntry.currency,
      exchangeRate: receiptEntry.exchangeRate,
      amountExchanged: receiptEntry.amountExchanged,
      comments: receiptEntry.comments,
      pmtType: receiptEntry.pmtType,
      invoiceId: receiptEntry.invoiceId,
    },
    journalVoucher: {
      id: journalVoucher.id,
      date: journalVoucher.date,
      jvNumber: journalVoucher.jvNumber,
      jvType: journalVoucher.jvType,
      totalDr: journalVoucher.totalDr,
      totalDrUSD: journalVoucher.totalDrUSD,
      totalDrLL: journalVoucher.totalDrLL,
      totalDrOFR: journalVoucher.totalDrOFR,
      totalDrUSDOFR: journalVoucher.totalDrUSDOFR,
      totalDrLLOFR: journalVoucher.totalDrLLOFR,
      totalCr: journalVoucher.totalCr,
      totalCrUSD: journalVoucher.totalCrUSD,
      totalCrLL: journalVoucher.totalCrLL,
      totalCrOFR: journalVoucher.totalCrOFR,
      totalCrUSDOFR: journalVoucher.totalCrUSDOFR,
      totalCrLLOFR: journalVoucher.totalCrLLOFR,
      exchangeRateAcc: journalVoucher.exchangeRateAcc,
      exchangeRateUSD: journalVoucher.exchangeRateUSD,
      details: (journalVoucher.details || []).map((detail: any) => ({
        id: detail.id,
        accountId: detail.accountId,
        account: detail.account
          ? {
              id: detail.account.id,
              name: detail.account.name,
              arabicAccountName: detail.account.arabicAccountName,
              code: detail.account.code,
              accountNumber: detail.account.accountNumber,
            }
          : null,
        supplierId: detail.supplierId,
        supplier: detail.supplier
          ? {
              id: detail.supplier.id,
              name: detail.supplier.name,
              supplierName: detail.supplier.supplierName,
            }
          : null,
        customerId: detail.customerId,
        customer: detail.customer
          ? {
              id: detail.customer.id,
              customerName: detail.customer.customerName,
            }
          : null,
        description: detail.description,
        check: detail.check,
        checkDate: detail.checkDate,
        bankName: detail.bankName,
        dr: detail.dr,
        drUSD: detail.drUSD,
        drLL: detail.drLL,
        drOFR: detail.drOFR,
        drUSDOFR: detail.drUSDOFR,
        drLLOFR: detail.drLLOFR,
        cr: detail.cr,
        crUSD: detail.crUSD,
        crLL: detail.crLL,
        crOFR: detail.crOFR,
        crUSDOFR: detail.crUSDOFR,
        crLLOFR: detail.crLLOFR,
        currency: detail.currency,
        exRateEUROToUSD: detail.exRateEUROToUSD,
        exRateUSD: detail.exRateUSD,
        docNbr: detail.docNbr,
        exchangeRateAcc: detail.exchangeRateAcc,
        exchangeRateUSD: detail.exchangeRateUSD,
      })),
    },
  };
}



// Add this method to your RecievablesService class (before the closing brace)

// Add this updated method to your RecievablesService class

// Fixed getDailyReceivables method for RecievablesService

async getDailyReceivables(params: {
  date: string; // 'YYYY-MM-DD'
  type?: 'G' | 'S' | 'ALL' | 'RVR';
  pmtType?: 'Cash' | 'Check' | 'ALL';
}) {
  const { date, type = 'ALL', pmtType = 'ALL' } = params;

  // Build the query
  const qb = this.entryRepo
    .createQueryBuilder('entry')
    .leftJoinAndSelect('entry.customer', 'customer')
    .leftJoinAndSelect('entry.journalVoucher', 'jv')
    .leftJoinAndSelect('entry.invoice', 'invoice')
    .where('DATE(entry.date) = :date', { date })
    .orderBy('entry.id', 'DESC');

  // Apply type filter
  if (type === 'ALL') {
    // ALL means both S and G (excludes RVR)
    qb.andWhere('entry.type IN (:...types)', { types: ['S', 'G'] });
  } else if (type === 'S' || type === 'G' || type === 'RVR') {
    // Specific type
    qb.andWhere('entry.type = :type', { type });
  }

  // Apply payment type filter if not 'ALL'
  if (pmtType !== 'ALL') {
    qb.andWhere('entry.pmtType = :pmtType', { pmtType });
  }

  const entries = await qb.getMany();

  // ✅ FIXED: Initialize totals as numbers with 0
  const totals = {
    usd: {
      cash: 0,
      check: 0,
      total: 0,
    },
    ll: {
      cash: 0,
      check: 0,
      total: 0,
    },
    overall: 0,
  };

  // Map entries and calculate totals
  const data = entries.map((entry) => {
    // ✅ FIXED: Convert to number explicitly
    const amount = Number(entry.cashNumber);
    const currency = entry.currency;
    const paymentType = entry.pmtType;

    // Add to totals
    if (currency === 'USD') {
      totals.usd.total += amount;
      if (paymentType === 'Cash') {
        totals.usd.cash += amount;
      } else {
        totals.usd.check += amount;
      }
    } else if (currency === 'LL') {
      totals.ll.total += amount;
      if (paymentType === 'Cash') {
        totals.ll.cash += amount;
      } else {
        totals.ll.check += amount;
      }
    }

    return {
      id: entry.id,
      customerId: entry.customerId,
      customerName: entry.customer?.customerName,
      customerAccountNumber: entry.customer?.customerAccountNumber || null,
      date: entry.date,
      invoiceId: entry.invoiceId,
      invoiceNumber: entry.invoice?.invoiceNumber ?? null,
      cashNumber: entry.cashNumber,
      currency: entry.currency,
      exchangeRate: entry.exchangeRate,
      amountExchanged: entry.amountExchanged,
      comments: entry.comments,
      type: entry.type,
      pmtType: entry.pmtType,
      jvNumber: entry.journalVoucher?.jvNumber,
    };
  });

  // Calculate overall total (USD equivalent)
  totals.overall = totals.usd.total;

  return {
    date,
    filters: {
      type,
      pmtType,
    },
    count: entries.length,
    totals,
    data,
  };
}


  async findFiltered(params: {
    type: 'S' | 'RVR';
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const { type, from, to, limit = 500 } = params;

    const qb = this.entryRepo
      .createQueryBuilder('entry')
      .leftJoin('entry.customer', 'customer')
      .leftJoin('entry.journalVoucher', 'jv')
      .select([
        'entry.id',
        'entry.type',
        'entry.date',
        'entry.cashNumber',
        'entry.currency',
        'entry.amountExchanged',
        'entry.exchangeRate',
        'entry.comments',
        'entry.pmtType',
        'entry.invoiceId',
        'entry.customerId',
        'customer.customerName',
        'jv.jvNumber',
      ])
      .where('entry.type = :type', { type })
      .orderBy('entry.date', 'DESC')
      .addOrderBy('entry.id', 'DESC')
      .take(Math.min(500, Math.max(1, Number(limit) || 500)));

    if (from) qb.andWhere('entry.date >= :from', { from });
    if (to) qb.andWhere('entry.date <= :to', { to });

    const entries = await qb.getMany();

    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      date: e.date,
      cashNumber: Number(e.cashNumber),
      currency: e.currency,
      amountExchanged: Number(e.amountExchanged ?? 0),
      exchangeRate: e.exchangeRate ?? null,
      comments: e.comments ?? null,
      pmtType: e.pmtType,
      invoiceId: e.invoiceId ?? null,
      customerId: e.customerId,
      customerName: (e as any).customer?.customerName ?? null,
      jvNumber: (e as any).journalVoucher?.jvNumber ?? null,
    }));
  }

  async convertReceivableType(id: number, newType: 'S' | 'RVR'): Promise<ReceiptEntry> {
    const entry = await this.entryRepo.findOne({
      where: { id },
      relations: ['journalVoucher', 'journalVoucher.details'],
    });
    if (!entry) throw new NotFoundException(`Receipt entry ${id} not found`);
    if (entry.type === newType) return entry;

    const jv = entry.journalVoucher;

    // S and RVR share the same 'RV' prefix — keep jvNumber unchanged.
    // Only recompute the header totals and detail lines.
    const usdPart = entry.currency === 'LL'
      ? Number(entry.amountExchanged)
      : Number(entry.cashNumber);
    const llPart = entry.currency === 'LL'
      ? Number(entry.cashNumber)
      : Number(entry.amountExchanged);

    let hdrDr = 0, hdrDrUSD = 0, hdrDrLL = 0;
    let hdrDrOFR = 0, hdrDrUSDOFR = 0, hdrDrLLOFR = 0;
    let hdrCr = 0, hdrCrUSD = 0, hdrCrLL = 0;
    let hdrCrOFR = 0, hdrCrUSDOFR = 0, hdrCrLLOFR = 0;

    if (newType === 'S') {
      hdrDr = usdPart; hdrDrUSD = usdPart; hdrDrLL = llPart;
      hdrDrOFR = usdPart; hdrDrUSDOFR = usdPart; hdrDrLLOFR = llPart;
      hdrCr = usdPart; hdrCrUSD = usdPart; hdrCrLL = llPart;
      hdrCrOFR = usdPart; hdrCrUSDOFR = usdPart; hdrCrLLOFR = llPart;
    } else {
      // RVR: official only, no OFR
      hdrDr = usdPart; hdrDrUSD = usdPart; hdrDrLL = llPart;
      hdrCr = usdPart; hdrCrUSD = usdPart; hdrCrLL = llPart;
    }

    Object.assign(jv, {
      jvType: newType,
      totalDr: hdrDr, totalDrUSD: hdrDrUSD, totalDrLL: hdrDrLL,
      totalDrOFR: hdrDrOFR, totalDrUSDOFR: hdrDrUSDOFR, totalDrLLOFR: hdrDrLLOFR,
      totalCr: hdrCr, totalCrUSD: hdrCrUSD, totalCrLL: hdrCrLL,
      totalCrOFR: hdrCrOFR, totalCrUSDOFR: hdrCrUSDOFR, totalCrLLOFR: hdrCrLLOFR,
    });
    await this.jvRepo.save(jv);

    // Rebuild detail lines
    await this.jvDetailRepo.delete({ journalVoucherId: jv.id });

    const cashRole = entry.currency === 'USD' ? 'Cash_USD' : 'Cash_LL';
    const cashAcct = await this.accountingResolver.resolveAccount(cashRole, null);
    if (!cashAcct) throw new NotFoundException(`Cash role ${cashRole} not mapped`);

    const normalizedCode = this.normalizeCurrencyCode(entry.currency);
    const exRateUSD = Number(entry.exchangeRate ?? 0);
    const exRateEUROToUSD = normalizedCode === 'EURO' ? exRateUSD : 0;

    let descriptionText: string | null = null;
    if (entry.pmtType === 'Cash') {
      const staticDesc = entry.currency === 'USD' ? 'دفعة نقدا $$' : 'دفعة نقدا LL';
      descriptionText = entry.comments?.trim()
        ? `${staticDesc} (${entry.comments.trim()})`
        : staticDesc;
    } else {
      descriptionText = entry.comments?.trim() || null;
    }

    const drLine = this.jvDetailRepo.create({
      journalVoucherId: jv.id,
      accountId: cashAcct.id,
      currency: normalizedCode,
      dr: hdrDr, drUSD: hdrDrUSD, drLL: hdrDrLL,
      drOFR: hdrDrOFR, drUSDOFR: hdrDrUSDOFR, drLLOFR: hdrDrLLOFR,
      cr: 0, crUSD: 0, crLL: 0, crOFR: 0, crUSDOFR: 0, crLLOFR: 0,
      exRateUSD, exRateEUROToUSD,
      description: descriptionText,
      docNbr: jv.jvNumber,
    });

    const crLine = this.jvDetailRepo.create({
      journalVoucherId: jv.id,
      customerId: entry.customerId,
      currency: normalizedCode,
      dr: 0, drUSD: 0, drLL: 0, drOFR: 0, drUSDOFR: 0, drLLOFR: 0,
      cr: hdrCr, crUSD: hdrCrUSD, crLL: hdrCrLL,
      crOFR: hdrCrOFR, crUSDOFR: hdrCrUSDOFR, crLLOFR: hdrCrLLOFR,
      exRateUSD, exRateEUROToUSD,
      description: descriptionText,
      docNbr: jv.jvNumber,
    });

    await this.jvDetailRepo.save([drLine, crLine]);

    entry.type = newType;
    const saved = await this.entryRepo.save(entry);

    this.gateway.broadcastAll(await this.findSummary());

    return { ...saved, jvNumber: jv.jvNumber } as any;
  }

  async sequenceAudit(yy: string) {
    // Fetch all RV entries for the year, ordered by numeric part of jvNumber
    const rows = await this.jvRepo
      .createQueryBuilder('jv')
      .leftJoin('jv.receiptEntries', 'entry')
      .leftJoin('entry.customer', 'customer')
      .select([
        'jv.id',
        'jv.jvNumber',
        'jv.jvType',
        'jv.date',
        'entry.id',
        'entry.cashNumber',
        'entry.currency',
        'entry.type',
        'customer.customerName',
      ])
      .where('jv.jvNumber LIKE :pat', { pat: `RV${yy}-%` })
      .orderBy('CAST(SUBSTRING_INDEX(jv.jvNumber, \'-\', -1) AS UNSIGNED)', 'ASC')
      .getMany();

    const result: Array<{
      jvId: number;
      entryId: number | null;
      jvNumber: string;
      seq: number;
      expectedSeq: number;
      isGap: boolean;        // gap BEFORE this entry (skipped numbers before it)
      skippedBefore: number; // how many numbers were skipped before this entry
      date: Date | null;
      customerName: string | null;
      cashNumber: number | null;
      currency: string | null;
      type: string | null;
    }> = [];

    let expectedSeq = 1;

    for (const jv of rows) {
      const rawSeq = parseInt((jv.jvNumber as string).split('-').pop()!, 10);
      const entry = (jv as any).receiptEntries?.[0] ?? null;

      const isGap = rawSeq > expectedSeq;
      const skippedBefore = isGap ? rawSeq - expectedSeq : 0;

      result.push({
        jvId: jv.id,
        entryId: entry?.id ?? null,
        jvNumber: jv.jvNumber,
        seq: rawSeq,
        expectedSeq,
        isGap,
        skippedBefore,
        date: jv.date ?? null,
        customerName: entry?.customer?.customerName ?? null,
        cashNumber: entry ? Number(entry.cashNumber) : null,
        currency: entry?.currency ?? null,
        type: entry?.type ?? (jv as any).jvType ?? null,
      });

      expectedSeq = rawSeq + 1;
    }

    return { year: `20${yy}`, prefix: `RV${yy}`, total: result.length, entries: result };
  }

  async fixJvNumber(entryId: number, newJvNumber: string) {
    const entry = await this.entryRepo.findOne({
      where: { id: entryId },
      relations: ['journalVoucher', 'journalVoucher.details'],
    });
    if (!entry) throw new NotFoundException(`Receipt entry ${entryId} not found`);

    const jv = entry.journalVoucher;
    if (!jv) throw new NotFoundException(`Journal voucher not found for entry ${entryId}`);

    // Check for duplicate
    const existing = await this.jvRepo.findOne({ where: { jvNumber: newJvNumber } });
    if (existing && existing.id !== jv.id) {
      throw new Error(`JV number ${newJvNumber} is already in use`);
    }

    const oldNumber = jv.jvNumber;
    jv.jvNumber = newJvNumber;
    await this.jvRepo.save(jv);

    // Update docNbr on all detail lines
    if (jv.details?.length) {
      for (const detail of jv.details) {
        if ((detail as any).docNbr === oldNumber) {
          (detail as any).docNbr = newJvNumber;
        }
      }
      await this.jvDetailRepo.save(jv.details as any[]);
    }

    return { ok: true, entryId, oldJvNumber: oldNumber, newJvNumber };
  }

}
