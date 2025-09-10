// src/receipt-voucher/recievables.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
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

    private readonly gateway: RecievablesGateway,
  ) {}

async create(data: {
  customerId: number;
  date: Date;
  invoiceId?: string;
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

  // 2) New JV number
  const lastJv = await this.jvRepo.find({
    where: { jvNumber: Like(`${prefix}${yy}-%`) },
    order: { jvNumber: 'DESC' },
    take: 1,
  });
  const seq = lastJv.length
    ? parseInt(lastJv[0].jvNumber.split('-')[1], 10) + 1
    : 1;
  const jvNumber = `${prefix}${yy}-${String(seq).padStart(3, '0')}`;

  // 3) Determine USD/LL parts from the two fields:
  //   - if currency=LL: cashNumber is LL, amountExchanged is USD
  //   - if currency=USD: cashNumber is USD, amountExchanged is LL
  const usdPart =
    data.currency === 'LL' ? data.amountExchanged : data.cashNumber;
  const llPart =
    data.currency === 'LL' ? data.cashNumber : data.amountExchanged;

  // 4) Compute header totals by type
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

  // 5) Persist JV header
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

  // 6) Create JV detail lines
  const cashAcct = await this.accountRepo.findOneBy({
    accountNumber: data.currency === 'USD' ? '5301' : '5302',
  });
  if (!cashAcct) throw new NotFoundException('Cash account not found');

  // >>> Added: auto description for cash payments
  const autoDesc =
    data.pmtType === 'Cash'
      ? (data.currency === 'USD' ? 'دفعة نقدا $$' : 'دفعة نقدا LL')
      : undefined;
  const descriptionText = autoDesc ?? data.comments ?? null;
  // <<<

  const drLine = this.jvDetailRepo.create({
    journalVoucherId: jv.id,
    accountId: cashAcct.id,
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
    description: descriptionText, // <-- use requested text
    docNbr: jvNumber,
  });

  const crLine = this.jvDetailRepo.create({
    journalVoucherId: jv.id,
    customerId: data.customerId,
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
    description: descriptionText, // <-- use requested text
    docNbr: jvNumber,
  });

  await this.jvDetailRepo.save([drLine, crLine]);

  // 7) Persist ReceiptEntry (store exchangeRate but not recalc)
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
  // ──────────────────────────────────────────────────────────────────────────────
  // 8) Broadcast the updated list of entries to all connected clients
  const all = await this.findSummary();
  this.gateway.broadcastAll(all);
  // ──────────────────────────────────────────────────────────────────────────────

  return savedEntry;
}


  async findSummary() {
    const entries = await this.entryRepo.find({
      relations: ['customer', 'journalVoucher'],
      order: {
        id: 'DESC',
      },
    });
    return entries.map((e) => ({
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
    }));
  }
  /*update an existing reciept + its jv */
  async update(
    id: number,
    data: {
      customerId: number;
      date: Date;
      invoiceId?: string;
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

    const jv = entry.journalVoucher;

    // recalc your JV‐number *only* if type changed (else keep the old one)
    if (data.type !== entry.type) {
      const yy = (
        await this.settingsRepo.findOne({ where: { isActive: true } })
      ).year.slice(-2);
      const prefix = data.type === 'G' ? 'RVG' : 'RV';
      const last = await this.jvRepo.find({
        where: { jvNumber: Like(`${prefix}${yy}-%`) },
        order: { jvNumber: 'DESC' },
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

    const cashAcct = await this.accountRepo.findOneBy({
      accountNumber: data.currency === 'USD' ? '5301' : '5302',
    });
    if (!cashAcct) throw new NotFoundException('Cash account not found');

    const drLine = this.jvDetailRepo.create({
      journalVoucherId: jv.id,
      accountId: cashAcct.id,
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
      description: data.comments ?? null,
    });
    const crLine = this.jvDetailRepo.create({
      journalVoucherId: jv.id,
      customerId: data.customerId,
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
      description: data.comments ?? null,
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

    return updated;
  }
}
