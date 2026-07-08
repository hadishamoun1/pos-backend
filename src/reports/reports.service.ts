import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Account } from '../entities/account.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { AccountRoleMap } from "../entities/accountRoleMap.entity";
import { Customer } from '../entities/customer.entity';
import { Supplier } from '../entities/supplier.entity';
import { CompanyService } from '../company/company.service';

import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { Item } from '../entities/inventory/item.entity';

// ✅ adjust path/name to your project


type TrialBalanceParams = {
  from?: string | null;
  to?: string | null;
  /** “level = N” => start displaying from codes whose DIGIT length = N, then descend by prefixes */
  level?: number;
  currency?: 'USD' | 'LL' | 'EURO' | 'BASE';
  invoiceType?: 'ALL' | 'S' | 'G';
  mainFrom?: string | null;
  mainTo?: string | null;
  subFrom?: string | null;
  subTo?: string | null;
  mainPrefixes?: string; // e.g. "601,705"
    tenantId?: number; // ✅ add this

};

/* ===== Row shapes for rollup ===== */
interface TBNodeSum {
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}
export interface InvoiceRow {
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string;
  customerId: number | null;
  customerName: string;
  itemCount: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  vatPercentage: number;
  vatStripped: boolean;
}

export interface MonthGroup {
  year: number;
  month: number;
  monthLabel: string;
  invoices: InvoiceRow[];
  totals: {
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
    invoiceCount: number;
  };
}

interface TBNode {
  keyDigits: string;         // digits-only key (group/leaf)
  code: string;              // group: prefix string (e.g. '224'), leaf: real accountNumber
  name: string;              // group: name if an account exists with same digits, else ''; leaf: account name
  parentCode?: string;       // parent group's prefix (for groups/leaves); undefined for roots
  children: Set<string>;     // internal keys
  sum: TBNodeSum;
  leafHasActivity: boolean;  // true only for real leaf accounts
  depth: number;             // 1-based depth relative to requested start level
}


interface ProfitabilityParams {
  from?: string | null;  // YYYY-MM-DD
  to?: string | null;
  customerId?: number;
  itemVariantId?: number;
  invoiceType?: 'S' | 'G' | 'RVR' | 'RTN' | 'ALL';
}

@Injectable()
export class ReportsService {
  constructor(

      private readonly dataSource: DataSource, 
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(JournalVoucherDetail)
    private readonly jvdRepo: Repository<JournalVoucherDetail>,
    @InjectRepository(JournalVoucher)
    private readonly jvRepo: Repository<JournalVoucher>,
      @InjectRepository(AccountRoleMap)
  private readonly accountRoleRepo: Repository<AccountRoleMap>,

  @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
  @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
   private readonly companyService: CompanyService,
  
  ) {}

  /* ===== small helpers ===== */
  private cmp(a: string, b: string) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  private digits(s?: string | null) {
    return String(s ?? '').replace(/\D/g, '');
  }
  private parsePrefixes(mainPrefixes?: string) {
    if (!mainPrefixes) return [];
    return mainPrefixes.split(',').map((v) => v.trim()).filter(Boolean);
  }

  /** Prefix-band: compare only first N digits where N = max(len(from), len(to)). */
  private withinPrefixBand(code: string, from?: string | null, to?: string | null) {
    const key = this.digits(code);
    const f = this.digits(from);
    const t = this.digits(to);

    if (f && t) {
      const n = Math.max(f.length, t.length);
      if (key.length < n) return false;
      const p = key.slice(0, n);
      const fPad = f.padEnd(n, '0');
      const tPad = t.padEnd(n, '9');
      return this.cmp(p, fPad) >= 0 && this.cmp(p, tPad) <= 0;
    } else if (f) {
      return key.startsWith(f);
    } else if (t) {
      return key.startsWith(t);
    }
    return true;
  }

      private cmpLexDigits(a: string, b: string) {
  const A = this.digits(a);
  const B = this.digits(b);
  return A.localeCompare(B, undefined, { numeric: false, sensitivity: 'base' });
}

  /** ALWAYS base columns (no OFR): used by the standard endpoint logic elsewhere */
  private getBaseCols(currency: 'USD' | 'LL' | 'EURO' | 'BASE') {
    const map = {
      USD: { dr: 'drUSD', cr: 'crUSD' },
      LL: { dr: 'drLL', cr: 'crLL' },
      EURO: { dr: 'dr', cr: 'cr' },
      BASE: { dr: 'dr', cr: 'cr' },
    } as const;
    const p = map[currency] ?? map.USD;
    return { drCol: p.dr as keyof JournalVoucherDetail, crCol: p.cr as keyof JournalVoucherDetail } as const;
  }

  /** OFR aware (for S vs G voucher math) */
  private getColsFor(rowKind: 'S' | 'G', currency: 'USD' | 'LL' | 'EURO' | 'BASE') {
    if (rowKind === 'G') {
      const ofr = {
        USD: { dr: 'drUSDOFR', cr: 'crUSDOFR' },
        LL:  { dr: 'drLLOFR',  cr: 'crLLOFR'  },
        EURO:{ dr: 'drOFR',    cr: 'crOFR'    },
        BASE:{ dr: 'drOFR',    cr: 'crOFR'    },
      } as const;
      const p = ofr[currency] ?? ofr.USD;
      return { drCol: p.dr as keyof JournalVoucherDetail, crCol: p.cr as keyof JournalVoucherDetail } as const;
    }
    return this.getBaseCols(currency);
  }

  /* =======================================================================
     PREFIX GROUPED TREE (capped to 3 group levels before the leaf)
     ======================================================================= */
  private buildPrefixTreeAndRollup(
    activeLeafSums: Map<string, TBNodeSum>,   // accountNumber -> sums
    accountsByCode: Map<string, Account>,
    startLevel: number
  ) {
    const digitsOnly = (s: string) => String(s ?? '').replace(/\D/g, '');

    // map digits-only → one matching account (for optional name on groups)
    const accByDigits = new Map<string, Account>();
    for (const acc of accountsByCode.values()) {
      const d = digitsOnly(acc.accountNumber);
      if (!accByDigits.has(d)) accByDigits.set(d, acc);
    }

    type Key = string;
    const gKey = (pref: string) => `G|${pref}`;   // group node key
    const lKey = (code: string)  => `L|${code}`;  // leaf node key

    const nodes = new Map<Key, TBNode>();
    const roots = new Set<Key>();

    const ensureGroup = (pref: string) => {
      const key = gKey(pref);
      let n = nodes.get(key);
      if (!n) {
        const acc = accByDigits.get(pref);
        n = {
          keyDigits: pref,
          code: pref,
          name: acc?.arabicAccountName ?? (acc as any)?.accountName ?? '',
          parentCode: undefined, // will be set when linked
          children: new Set<Key>(),
          sum: { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
          leafHasActivity: false,
          depth: Math.max(1, pref.length - startLevel + 1),
        };
        nodes.set(key, n);
      }
      return n;
    };

    const ensureLeaf = (code: string) => {
      const key = lKey(code);
      let n = nodes.get(key);
      if (!n) {
        const acc = accountsByCode.get(code);
        n = {
          keyDigits: digitsOnly(code),
          code,
          name: String(acc?.arabicAccountName ?? (acc as any)?.accountName ?? ''),
          parentCode: undefined, // will be set when linked
          children: new Set<Key>(),
          sum: { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
          leafHasActivity: true,
          depth: 1,
        };
        nodes.set(key, n);
      }
      return n;
    };

    const MAX_GROUP_LEVELS = 3; // cap to 3 group prefixes (level, level+1, level+2)

    // 1) create leaves and attach under prefix groups (capped) + set parentCode
    for (const [accCode, sums] of activeLeafSums) {
      const leaf = ensureLeaf(accCode);
      // set leaf sums
      leaf.sum.openingBalance += sums.openingBalance;
      leaf.sum.periodDebit    += sums.periodDebit;
      leaf.sum.periodCredit   += sums.periodCredit;
      leaf.sum.closingBalance += sums.closingBalance;

      const d = leaf.keyDigits;
      if (!d) continue;

      if (d.length > startLevel) {
        // chain of groups from startLevel up to min(d.length - 1, startLevel + MAX_GROUP_LEVELS - 1)
        let parentKey: Key | null = null;
        const lastGroupLen = Math.min(d.length - 1, startLevel + MAX_GROUP_LEVELS - 1);
        for (let k = startLevel; k <= lastGroupLen; k++) {
          const pref = d.slice(0, k);
          const g = ensureGroup(pref);
          const gK = gKey(pref);
          if (k === startLevel) roots.add(gK); // root groups at the first level
          if (parentKey) {
            // link parent group → child group + set child's parentCode
            nodes.get(parentKey)!.children.add(gK);
            const child = nodes.get(gK)!;
            child.parentCode = nodes.get(parentKey)!.code; // parent group's code (prefix)
          }
          parentKey = gK;
        }
        if (parentKey) {
          // link last group → leaf + set leaf parentCode
          nodes.get(parentKey)!.children.add(lKey(accCode));
          leaf.parentCode = nodes.get(parentKey)!.code; // parent group's prefix
          leaf.depth = nodes.get(parentKey)!.depth + 1;
        }
      } else {
        // equal to start level (or shorter)
        const rootGKey = gKey(d);
        if (nodes.has(rootGKey)) {
          nodes.get(rootGKey)!.children.add(lKey(accCode));
          leaf.parentCode = nodes.get(rootGKey)!.code;
          leaf.depth = nodes.get(rootGKey)!.depth + 1;
        } else {
          // no group node at this prefix -> leaf is a root
          roots.add(lKey(accCode));
          leaf.parentCode = undefined;
          leaf.depth = 1;
        }
      }
    }

    // 2) roll-up sums (postorder)
    const visited = new Set<Key>();
    const post = (key: Key): TBNodeSum => {
      if (visited.has(key)) return nodes.get(key)!.sum;
      visited.add(key);
      const n = nodes.get(key)!;
      if (n.children.size === 0) return n.sum;
      const s = { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 };
      for (const ch of n.children) {
        const cs = post(ch);
        s.openingBalance += cs.openingBalance;
        s.periodDebit    += cs.periodDebit;
        s.periodCredit   += cs.periodCredit;
        s.closingBalance += cs.closingBalance;
      }
      n.sum = s;
      return s;
    };
    for (const r of roots) post(r);

    // 3) preorder emit groups first, then children (sorted by digits)
    const keyDigits = (k: Key) => nodes.get(k)!.keyDigits;
    const sortByDigits = (a: Key, b: Key) =>
      keyDigits(a).localeCompare(keyDigits(b), undefined, { numeric: false, sensitivity: 'base' });

    const orderedKeys: Key[] = [];
    const pre = (k: Key) => {
      orderedKeys.push(k);
      const kids = Array.from(nodes.get(k)!.children).sort(sortByDigits);
      for (const ch of kids) pre(ch);
    };
    for (const r of Array.from(roots).sort(sortByDigits)) pre(r);

    return { nodes, orderedKeys };
  }

  /* =======================================================================
     GROUPED TRIAL BALANCE (by digit prefixes)
     ======================================================================= */
  async getTrialBalance(params: TrialBalanceParams) {
    const {
      from,
      to,
      level,
      currency = 'USD',
      invoiceType = 'ALL',
      mainFrom,
      mainTo,
      subFrom,
      subTo,
      mainPrefixes,
    } = params;

    // 1) Load accounts (need names to label leaves; may label groups if an exact account exists for a prefix)
    const accounts = await this.accountRepo.find({
      select: ['id', 'accountNumber', 'arabicAccountName', 'parentNumber'],
    });
    const accountsByCode = new Map<string, Account>(accounts.map((a) => [String(a.accountNumber), a]));

    // 2) Selection by bands / prefixes (which accounts can contribute activity)
    const prefixes = this.parsePrefixes(mainPrefixes);
    let selected = accounts;
    if (prefixes.length) {
      selected = selected.filter((a) =>
        prefixes.some((p) => this.digits(a.accountNumber).startsWith(this.digits(p))),
      );
    } else if (subFrom || subTo) {
      selected = selected.filter((a) => this.withinPrefixBand(String(a.accountNumber), subFrom, subTo));
    } else if (mainFrom || mainTo) {
      selected = selected.filter((a) => this.withinPrefixBand(String(a.accountNumber), mainFrom, mainTo));
    }
    const selectedIds = new Set<number>(selected.map((a) => a.id));
    if (!selectedIds.size) {
      return {
        from: from ?? null,
        to: to ?? null,
        currency,
        invoiceType,
        rows: [],
        totals: { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
      };
    }

    // 3) Invoice-type filter
    const applyTypeFilter = (qb: ReturnType<typeof this.jvdRepo.createQueryBuilder>) => {
      if (invoiceType === 'S') {
        qb.andWhere('(jv.jvType = :tS OR d.docNbr LIKE :sPrefix)', { tS: 'S', sPrefix: 'S%' });
      } else if (invoiceType === 'G') {
        qb.andWhere('(jv.jvType = :tG OR d.docNbr LIKE :gPrefix)', { tG: 'G', gPrefix: 'G%' });
      }
      return qb;
    };

    // 4) Opening (before `from`)
    let openingRows: JournalVoucherDetail[] = [];
    if (from) {
      const openQb = this.jvdRepo
        .createQueryBuilder('d')
        .leftJoinAndSelect('d.journalVoucher', 'jv')
        .leftJoinAndSelect('d.account', 'acc')
        .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) })
        .andWhere('jv.date < :from', { from });
      applyTypeFilter(openQb);
      openingRows = await openQb.getMany();
    }

    // 5) Period ([from..to])
    const periodQb = this.jvdRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.journalVoucher', 'jv')
      .leftJoinAndSelect('d.account', 'acc')
      .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) });
    if (from) periodQb.andWhere('jv.date >= :from', { from });
    if (to)   periodQb.andWhere('jv.date <= :to',   { to });
    applyTypeFilter(periodQb);
    const periodRows = await periodQb.getMany();

    // 6) Sum by accountId using correct columns (OFR for G)
    const pickCols = (r: JournalVoucherDetail) => {
      const isG = r.journalVoucher?.jvType === 'G' || (r.docNbr?.startsWith('G') ?? false);
      const { drCol, crCol } = this.getColsFor(isG ? 'G' : 'S', currency);
      return {
        debit:  Number((r as any)[drCol] || 0),
        credit: Number((r as any)[crCol] || 0),
      };
    };

    const openingByAcc = new Map<number, { debit: number; credit: number }>();
    for (const r of openingRows) {
      const prev = openingByAcc.get(r.accountId) ?? { debit: 0, credit: 0 };
      const { debit, credit } = pickCols(r);
      prev.debit  += debit;
      prev.credit += credit;
      openingByAcc.set(r.accountId, prev);
    }

    const periodByAcc = new Map<number, { debit: number; credit: number }>();
    for (const r of periodRows) {
      const prev = periodByAcc.get(r.accountId) ?? { debit: 0, credit: 0 };
      const { debit, credit } = pickCols(r);
      prev.debit  += debit;
      prev.credit += credit;
      periodByAcc.set(r.accountId, prev);
    }

    // 7) Active accounts (appear in opening or period)
    const activeIds = new Set<number>([
      ...Array.from(openingByAcc.keys()),
      ...Array.from(periodByAcc.keys()),
    ]);
    if (!activeIds.size) {
      return {
        from: from ?? null,
        to: to ?? null,
        currency,
        invoiceType,
        rows: [],
        totals: { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
      };
    }

    // 8) Prepare leaf sums by **real accountNumber** (for selected + active)
    const activeLeafSums = new Map<string, TBNodeSum>(); // accountNumber -> sums
    for (const acc of selected) {
      if (!activeIds.has(acc.id)) continue;
      const op = openingByAcc.get(acc.id) ?? { debit: 0, credit: 0 };
      const pr = periodByAcc.get(acc.id) ?? { debit: 0, credit: 0 };
      const openingBalance = op.debit - op.credit;
      const closingBalance = openingBalance + (pr.debit - pr.credit);

      activeLeafSums.set(String(acc.accountNumber), {
        openingBalance,
        periodDebit:  pr.debit,
        periodCredit: pr.credit,
        closingBalance,
      });
    }

    // 9) Build PREFIX tree (virtual groups by digits) & rollup (capped to 3 groups)
    const startLevel = Math.max(1, Number(level || 1));
    const { nodes, orderedKeys } =
      this.buildPrefixTreeAndRollup(activeLeafSums, accountsByCode, startLevel);

    // 10) Emit rows (groups and leaves) WITH parentCode
    const rows = orderedKeys.map((k) => {
      const n = nodes.get(k)!;
      return {
        accountCode: n.code,                // groups: "22","224",...  leaves: real account number
        accountName: n.name || '',          // group name if exact account exists; otherwise empty
        parentCode: n.parentCode ?? null,   // 👈 added
        openingBalance: n.sum.openingBalance,
        periodDebit:    n.sum.periodDebit,
        periodCredit:   n.sum.periodCredit,
        closingBalance: n.sum.closingBalance,
        isGroup: n.children.size > 0,
        depth: n.depth,
      };
    });

    // 11) Totals from leaves only (no double-counting)
    const totals = Array.from(nodes.values())
      .filter((n) => n.children.size === 0 && n.leafHasActivity)
      .reduce(
        (t, n) => {
          t.openingBalance += n.sum.openingBalance;
          t.periodDebit    += n.sum.periodDebit;
          t.periodCredit   += n.sum.periodCredit;
          t.closingBalance += n.sum.closingBalance;
          return t;
        },
        { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
      );

    return {
      from: from ?? null,
      to: to ?? null,
      currency,
      invoiceType,
      rows,
      totals,
    };
  }





async getTrialBalanceStandard(params: TrialBalanceParams) {
  const {
    from,
    to,
    currency = 'USD',
    invoiceType = 'ALL',
    mainFrom,
    mainTo,
    subFrom,
    subTo,
    mainPrefixes,
  } = params;

  // 0) Read Customer/Supplier index from AccountRoleMap
  const roleRows = await this.accountRoleRepo.find({
    select: ['role', 'currencyCode', 'accountNumber'],
  });

  const roleName = (r: AccountRoleMap) => String(r.role || '').trim().toLowerCase();

  const customerIndex =
    roleRows.find((r) => roleName(r) === 'customer_index')?.accountNumber ?? null;

  const supplierIndex =
    roleRows.find((r) => roleName(r) === 'supplier_index')?.accountNumber ?? null;

  // 1) Load accounts
  const accounts = await this.accountRepo.find({
    select: ['id', 'accountNumber', 'arabicAccountName', 'accountName', 'parentNumber'],
  });

  const byNumber = new Map<string, Account>(accounts.map((a) => [String(a.accountNumber), a]));
  const byId = new Map<number, Account>(accounts.map((a) => [a.id, a]));

  // 2) Apply your existing selection logic
  const prefixes = this.parsePrefixes(mainPrefixes);
  let selected = accounts;

  if (prefixes.length) {
    selected = selected.filter((a) =>
      prefixes.some((p) => this.digits(a.accountNumber).startsWith(this.digits(p))),
    );
  } else if (subFrom || subTo) {
    selected = selected.filter((a) =>
      this.withinPrefixBand(String(a.accountNumber), subFrom, subTo),
    );
  } else if (mainFrom || mainTo) {
    selected = selected.filter((a) =>
      this.withinPrefixBand(String(a.accountNumber), mainFrom, mainTo),
    );
  }

  const selectedIds = new Set<number>(selected.map((a) => a.id));

  const isInScope = (indexAccNumber: string | null) => {
    if (!indexAccNumber) return false;
    const idx = String(indexAccNumber);

    // if it exists in accounts and already selected, it's in scope
    const idxAcc = byNumber.get(idx);
    if (idxAcc && selectedIds.has(idxAcc.id)) return true;

    // if prefixes exist and match index
    if (prefixes.length && prefixes.some((p) => this.digits(idx).startsWith(this.digits(p))))
      return true;

    // otherwise: not in scope
    return false;
  };

  const customerIndexInScope = isInScope(customerIndex);
  const supplierIndexInScope = isInScope(supplierIndex);

  // 3) (Optional) include customer/supplier ACCOUNTS if they exist in accounts table
  //    This helps when JVD uses accountId (traditional TB) and parentNumber isn't set.
  const forcedParentByAccountId = new Map<number, string>(); // accountId -> forced parentCode

  if (customerIndexInScope && customerIndex) {
    const customers = await this.customerRepo.find({
      select: ['customerAccountNumber', 'customerName'],
    });

    for (const c of customers) {
      const accNum = String(c.customerAccountNumber || '').trim();
      if (!accNum) continue;

      const acc = byNumber.get(accNum);
      if (acc) {
        selectedIds.add(acc.id);
        forcedParentByAccountId.set(acc.id, String(customerIndex));
      }
    }
  }

  if (supplierIndexInScope && supplierIndex) {
    const suppliers = await this.supplierRepo.find({
      select: ['supplierAccountNumber', 'supplierName'],
    });

    for (const s of suppliers) {
      const accNum = String(s.supplierAccountNumber || '').trim();
      if (!accNum) continue;

      const acc = byNumber.get(accNum);
      if (acc) {
        selectedIds.add(acc.id);
        forcedParentByAccountId.set(acc.id, String(supplierIndex));
      }
    }
  }

  if (!selectedIds.size) {
    return {
      from: from ?? null,
      to: to ?? null,
      currency,
      invoiceType,
      rows: [],
      totals: {
        openingDebit: 0,
        openingCredit: 0,
        openingBalance: 0,
        periodDebit: 0,
        periodCredit: 0,
        balance: 0,
        closingBalance: 0,
      },
    };
  }

  // 4) Currency columns
  const { drCol, crCol } = this.getBaseCols(currency);

  // 5) Invoice type predicate
  const invoiceTypeSql =
    invoiceType === 'S'
      ? "(jv.jvType = 'S' OR d.docNbr LIKE 'S%')"
      : invoiceType === 'G'
        ? "(jv.jvType = 'G' OR d.docNbr LIKE 'G%')"
        : '1=1';

  // 6) Aggregate by accountId (classic TB)
  const qb = this.jvdRepo
    .createQueryBuilder('d')
    .leftJoin('d.journalVoucher', 'jv')
    .select('d.accountId', 'accountId')
    .addSelect(
      `SUM(CASE WHEN ${from ? 'jv.date < :from' : '0'} THEN d.${drCol} ELSE 0 END)`,
      'openDebit',
    )
    .addSelect(
      `SUM(CASE WHEN ${from ? 'jv.date < :from' : '0'} THEN d.${crCol} ELSE 0 END)`,
      'openCredit',
    )
    .addSelect(
      `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : '1')} AND ${(to ? 'jv.date <= :to' : '1')} THEN d.${drCol} ELSE 0 END)`,
      'perDebit',
    )
    .addSelect(
      `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : '1')} AND ${(to ? 'jv.date <= :to' : '1')} THEN d.${crCol} ELSE 0 END)`,
      'perCredit',
    )
    .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) })
    .andWhere(invoiceTypeSql)
    .groupBy('d.accountId');

  if (from) qb.setParameter('from', from);
  if (to) qb.setParameter('to', to);

  const raw = await qb.getRawMany<{
    accountId: number | string;
    openDebit: string;
    openCredit: string;
    perDebit: string;
    perCredit: string;
  }>();

  const rawByAcc = new Map<number, (typeof raw)[number]>();
  for (const r of raw) rawByAcc.set(Number(r.accountId), r);

  // 7) Aggregate by customerId and supplierId (so they show even if accountId is null)
  let custAgg: Array<{
    customerId: number | string;
    accountNumber: string;
    name: string;
    openDebit: string;
    openCredit: string;
    perDebit: string;
    perCredit: string;
  }> = [];

  if (customerIndexInScope && customerIndex) {
    const custQb = this.jvdRepo
      .createQueryBuilder('d')
      .leftJoin('d.journalVoucher', 'jv')
      .innerJoin('d.customer', 'c')
      .select('d.customerId', 'customerId')
      .addSelect('c.customerAccountNumber', 'accountNumber')
      .addSelect('c.customerName', 'name')
      .addSelect(
        `SUM(CASE WHEN ${from ? 'jv.date < :from' : '0'} THEN d.${drCol} ELSE 0 END)`,
        'openDebit',
      )
      .addSelect(
        `SUM(CASE WHEN ${from ? 'jv.date < :from' : '0'} THEN d.${crCol} ELSE 0 END)`,
        'openCredit',
      )
      .addSelect(
        `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : '1')} AND ${(to ? 'jv.date <= :to' : '1')} THEN d.${drCol} ELSE 0 END)`,
        'perDebit',
      )
      .addSelect(
        `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : '1')} AND ${(to ? 'jv.date <= :to' : '1')} THEN d.${crCol} ELSE 0 END)`,
        'perCredit',
      )
      .where('d.customerId IS NOT NULL')
      .andWhere(invoiceTypeSql)
      .groupBy('d.customerId')
      .addGroupBy('c.customerAccountNumber')
      .addGroupBy('c.customerName');

    if (from) custQb.setParameter('from', from);
    if (to) custQb.setParameter('to', to);

    custAgg = await custQb.getRawMany();
  }

  let suppAgg: Array<{
    supplierId: number | string;
    accountNumber: string;
    name: string;
    openDebit: string;
    openCredit: string;
    perDebit: string;
    perCredit: string;
  }> = [];

  if (supplierIndexInScope && supplierIndex) {
    const suppQb = this.jvdRepo
      .createQueryBuilder('d')
      .leftJoin('d.journalVoucher', 'jv')
      .innerJoin('d.supplier', 's')
      .select('d.supplierId', 'supplierId')
      .addSelect('s.supplierAccountNumber', 'accountNumber')
      .addSelect('s.supplierName', 'name')
      .addSelect(
        `SUM(CASE WHEN ${from ? 'jv.date < :from' : '0'} THEN d.${drCol} ELSE 0 END)`,
        'openDebit',
      )
      .addSelect(
        `SUM(CASE WHEN ${from ? 'jv.date < :from' : '0'} THEN d.${crCol} ELSE 0 END)`,
        'openCredit',
      )
      .addSelect(
        `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : '1')} AND ${(to ? 'jv.date <= :to' : '1')} THEN d.${drCol} ELSE 0 END)`,
        'perDebit',
      )
      .addSelect(
        `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : '1')} AND ${(to ? 'jv.date <= :to' : '1')} THEN d.${crCol} ELSE 0 END)`,
        'perCredit',
      )
      .where('d.supplierId IS NOT NULL')
      .andWhere(invoiceTypeSql)
      .groupBy('d.supplierId')
      .addGroupBy('s.supplierAccountNumber')
      .addGroupBy('s.supplierName');

    if (from) suppQb.setParameter('from', from);
    if (to) suppQb.setParameter('to', to);

    suppAgg = await suppQb.getRawMany();
  }

  // 8) Build rows
  const rows: any[] = [];

  // 8.1) Account rows (by accountId)
  for (const id of Array.from(selectedIds)) {
    const acc = byId.get(id);
    if (!acc) continue;

    const agg = rawByAcc.get(acc.id);

    // IMPORTANT:
    // - Do not drop "index" accounts (Customer_Index/Supplier_Index) even if no movement
    // - For other accounts: keep zeros or skip based on your preference
    const openDebit = agg ? +agg.openDebit || 0 : 0;
    const openCredit = agg ? +agg.openCredit || 0 : 0;
    const perDebit = agg ? +agg.perDebit || 0 : 0;
    const perCredit = agg ? +agg.perCredit || 0 : 0;

    // If you want to hide empty accounts EXCEPT the indexes, use:
    const isIndexAcc =
      (customerIndex && String(acc.accountNumber) === String(customerIndex)) ||
      (supplierIndex && String(acc.accountNumber) === String(supplierIndex));

    if (!agg && !isIndexAcc) continue;

    const openingBalance = openDebit - openCredit;
    const balance = perDebit - perCredit;
    const closingBalance = openingBalance + balance;

    const forcedParent = forcedParentByAccountId.get(acc.id) ?? null;
    const parentCode = forcedParent ?? (acc.parentNumber ? String(acc.parentNumber) : null);
    const parentAcc = parentCode ? byNumber.get(parentCode) : undefined;

    rows.push({
      accountCode: String(acc.accountNumber),
      accountName: String(acc.arabicAccountName ?? acc.accountName ?? ''),
      parentCode,
      parentName: parentAcc ? String(parentAcc.arabicAccountName ?? parentAcc.accountName ?? '') : null,

      openingDebit: openDebit,
      openingCredit: openCredit,
      openingBalance,

      periodDebit: perDebit,
      periodCredit: perCredit,
      balance,

      closingBalance,
    });
  }

  // 8.2) Customer rows (by customerId) under Customer_Index
  if (customerIndexInScope && customerIndex) {
    const parentAcc = byNumber.get(String(customerIndex));
    const parentName = parentAcc
      ? String(parentAcc.arabicAccountName ?? parentAcc.accountName ?? '')
      : null;

    for (const r of custAgg) {
      const openDebit = +r.openDebit || 0;
      const openCredit = +r.openCredit || 0;
      const perDebit = +r.perDebit || 0;
      const perCredit = +r.perCredit || 0;

      const openingBalance = openDebit - openCredit;
      const balance = perDebit - perCredit;
      const closingBalance = openingBalance + balance;

      rows.push({
        accountCode: String(r.accountNumber),
        accountName: String(r.name),
        parentCode: String(customerIndex),
        parentName,

        openingDebit: openDebit,
        openingCredit: openCredit,
        openingBalance,

        periodDebit: perDebit,
        periodCredit: perCredit,
        balance,

        closingBalance,
      });
    }
  }

  // 8.3) Supplier rows (by supplierId) under Supplier_Index
  if (supplierIndexInScope && supplierIndex) {
    const parentAcc = byNumber.get(String(supplierIndex));
    const parentName = parentAcc
      ? String(parentAcc.arabicAccountName ?? parentAcc.accountName ?? '')
      : null;

    for (const r of suppAgg) {
      const openDebit = +r.openDebit || 0;
      const openCredit = +r.openCredit || 0;
      const perDebit = +r.perDebit || 0;
      const perCredit = +r.perCredit || 0;

      const openingBalance = openDebit - openCredit;
      const balance = perDebit - perCredit;
      const closingBalance = openingBalance + balance;

      rows.push({
        accountCode: String(r.accountNumber),
        accountName: String(r.name),
        parentCode: String(supplierIndex),
        parentName,

        openingDebit: openDebit,
        openingCredit: openCredit,
        openingBalance,

        periodDebit: perDebit,
        periodCredit: perCredit,
        balance,

        closingBalance,
      });
    }
  }

  // 9) Sort + totals
  rows.sort((a, b) => this.cmpLexDigits(String(a.accountCode), String(b.accountCode)));

  const totals = rows.reduce(
    (t, r) => {
      t.openingDebit += Number(r.openingDebit) || 0;
      t.openingCredit += Number(r.openingCredit) || 0;
      t.openingBalance += Number(r.openingBalance) || 0;
      t.periodDebit += Number(r.periodDebit) || 0;
      t.periodCredit += Number(r.periodCredit) || 0;
      t.balance += Number(r.balance) || 0;
      t.closingBalance += Number(r.closingBalance) || 0;
      return t;
    },
    {
      openingDebit: 0,
      openingCredit: 0,
      openingBalance: 0,
      periodDebit: 0,
      periodCredit: 0,
      balance: 0,
      closingBalance: 0,
    },
  );

  return {
    from: from ?? null,
    to: to ?? null,
    currency,
    invoiceType,
    rows,
    totals,
  };
}



/* ===== CURRENCIES ENDPOINT (JV-only rows, USD main + LL extra) ===== */
async getTrialBalanceCurrencies(params: TrialBalanceParams) {
  const {
    from,
    to,
    currency = 'USD',         // kept for compatibility; NOT used for math here
    invoiceType = 'ALL',
    mainFrom,
    mainTo,
    subFrom,
    subTo,
    mainPrefixes,
    level,
  } = params;

  // 1) Accounts & selection (kept: your existing helpers)
  const accounts = await this.accountRepo.find({
    select: ['id', 'accountNumber', 'arabicAccountName', 'parentNumber'],
  });
  const byCode = new Map<string, Account>(accounts.map(a => [String(a.accountNumber), a]));

  const prefixes = this.parsePrefixes(mainPrefixes);
  let selected = accounts;
  if (prefixes.length) {
    selected = selected.filter(a =>
      prefixes.some(p => this.digits(a.accountNumber).startsWith(this.digits(p))),
    );
  } else if (subFrom || subTo) {
    selected = selected.filter(a => this.withinPrefixBand(String(a.accountNumber), subFrom, subTo));
  } else if (mainFrom || mainTo) {
    selected = selected.filter(a => this.withinPrefixBand(String(a.accountNumber), mainFrom, mainTo));
  }

  const selectedIds = new Set<number>(selected.map(a => a.id));
  if (!selectedIds.size) {
    return {
      from: from ?? null,
      to: to ?? null,
      currency, // echoed only
      invoiceType,
      rows: [],
      totals: {
        openingDebit: 0, openingCredit: 0, openingBalance: 0,
        periodDebit: 0, periodCredit: 0, balance: 0, closingBalance: 0,
        openingBalanceLL: 0, periodDebitLL: 0, periodCreditLL: 0, balanceLL: 0, closingBalanceLL: 0,
      },
    };
  }

  // 2) Invoice type predicate (kept behavior: S = S or docNbr S%, G = G or docNbr G%)
  const invoiceTypeSql =
    invoiceType === 'S'
      ? "(jv.jvType = 'S' OR d.docNbr LIKE 'S%')"
      : invoiceType === 'G'
      ? "(jv.jvType = 'G' OR d.docNbr LIKE 'G%')"
      : '1=1';

  // 3) Single aggregated query (opening + period, USD + LL) — FAST
  // Notes:
  //  - We use getRawMany() to avoid instantiating entities for every JV detail row.
  //  - We only join JV to access date (and jvType for the filter).
  //  - CASE WHEN ... THEN ... END sums keep everything in one pass.
  const qb = this.jvdRepo
    .createQueryBuilder('d')
    .leftJoin('d.journalVoucher', 'jv')
    .select('d.accountId', 'accountId')
    // Opening: date < :from (if from given; otherwise sums 0)
    .addSelect(`SUM(CASE WHEN ${from ? 'jv.date < :from' : 'FALSE'} THEN d.drUSD ELSE 0 END)`, 'openDebitUSD')
    .addSelect(`SUM(CASE WHEN ${from ? 'jv.date < :from' : 'FALSE'} THEN d.crUSD ELSE 0 END)`, 'openCreditUSD')
    .addSelect(`SUM(CASE WHEN ${from ? 'jv.date < :from' : 'FALSE'} THEN d.drLL  ELSE 0 END)`, 'openDebitLL')
    .addSelect(`SUM(CASE WHEN ${from ? 'jv.date < :from' : 'FALSE'} THEN d.crLL  ELSE 0 END)`, 'openCreditLL')
    // Period: from..to (if bounds given; otherwise TRUE to include all)
    .addSelect(
      `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : 'TRUE')} AND ${(to ? 'jv.date <= :to' : 'TRUE')} THEN d.drUSD ELSE 0 END)`,
      'perDebitUSD',
    )
    .addSelect(
      `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : 'TRUE')} AND ${(to ? 'jv.date <= :to' : 'TRUE')} THEN d.crUSD ELSE 0 END)`,
      'perCreditUSD',
    )
    .addSelect(
      `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : 'TRUE')} AND ${(to ? 'jv.date <= :to' : 'TRUE')} THEN d.drLL  ELSE 0 END)`,
      'perDebitLL',
    )
    .addSelect(
      `SUM(CASE WHEN ${(from ? 'jv.date >= :from' : 'TRUE')} AND ${(to ? 'jv.date <= :to' : 'TRUE')} THEN d.crLL  ELSE 0 END)`,
      'perCreditLL',
    )
    .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) })
    .andWhere(invoiceTypeSql)
    .groupBy('d.accountId');

  if (from) qb.setParameter('from', from);
  if (to) qb.setParameter('to', to);

  const raw = await qb.getRawMany<{
    accountId: number;
    openDebitUSD: string; openCreditUSD: string;
    openDebitLL: string;  openCreditLL: string;
    perDebitUSD: string;  perCreditUSD: string;
    perDebitLL: string;   perCreditLL: string;
  }>();

  // 4) Fast lookup by accountId
  const rawByAcc = new Map<number, typeof raw[number]>();
  for (const r of raw) rawByAcc.set(Number(r.accountId), r);

  // 5) Build rows (USD main + LL extras), prefix-friendly sort (kept)
  const rows = selected
    .map(acc => {
      const r = rawByAcc.get(acc.id);
      if (!r) return null;

      const openDebitUSD  = +r.openDebitUSD  || 0;
      const openCreditUSD = +r.openCreditUSD || 0;
      const perDebitUSD   = +r.perDebitUSD   || 0;
      const perCreditUSD  = +r.perCreditUSD  || 0;

      const openDebitLL  = +r.openDebitLL  || 0;
      const openCreditLL = +r.openCreditLL || 0;
      const perDebitLL   = +r.perDebitLL   || 0;
      const perCreditLL  = +r.perCreditLL  || 0;

      // USD main
      const openingBalance = openDebitUSD - openCreditUSD;
      const balance        = perDebitUSD - perCreditUSD;   // period net USD
      const closingBalance = openingBalance + balance;

      // LL extras
      const openingBalanceLL = openDebitLL - openCreditLL;
      const balanceLL        = perDebitLL - perCreditLL;   // period net LL
      const closingBalanceLL = openingBalanceLL + balanceLL;

      const parentAcc = acc.parentNumber ? byCode.get(acc.parentNumber) : undefined;

      return {
        accountCode: String(acc.accountNumber),
        accountName: String(acc.arabicAccountName ?? ''),
        parentCode:  parentAcc ? String(parentAcc.accountNumber) : null,
        parentName:  parentAcc ? String(parentAcc.arabicAccountName ?? '') : null,

        // USD (main columns in your UI)
        openingDebit:  openDebitUSD,
        openingCredit: openCreditUSD,
        openingBalance,
        periodDebit:   perDebitUSD,
        periodCredit:  perCreditUSD,
        balance,
        closingBalance,

        // LL (extra columns requested)
        openingBalanceLL,
        periodDebitLL:  perDebitLL,
        periodCreditLL: perCreditLL,
        balanceLL,
        closingBalanceLL,
      };
    })
    .filter(Boolean)
    .sort((a, b) => this.cmpLexDigits((a as any).accountCode, (b as any).accountCode)) as Array<{
      accountCode: string;
      accountName: string;
      parentCode: string | null;
      parentName: string | null;
      openingDebit: number;
      openingCredit: number;
      openingBalance: number;
      periodDebit: number;
      periodCredit: number;
      balance: number;
      closingBalance: number;
      openingBalanceLL: number;
      periodDebitLL: number;
      periodCreditLL: number;
      balanceLL: number;
      closingBalanceLL: number;
    }>;

  // 6) Totals (unchanged logic)
  const totals = rows.reduce(
    (t, r) => {
      t.openingDebit   += r.openingDebit;
      t.openingCredit  += r.openingCredit;
      t.openingBalance += r.openingBalance;
      t.periodDebit    += r.periodDebit;
      t.periodCredit   += r.periodCredit;
      t.balance        += r.balance;
      t.closingBalance += r.closingBalance;

      t.openingBalanceLL += r.openingBalanceLL;
      t.periodDebitLL    += r.periodDebitLL;
      t.periodCreditLL   += r.periodCreditLL;
      t.balanceLL        += r.balanceLL;
      t.closingBalanceLL += r.closingBalanceLL;
      return t;
    },
    {
      openingDebit: 0,
      openingCredit: 0,
      openingBalance: 0,
      periodDebit: 0,
      periodCredit: 0,
      balance: 0,
      closingBalance: 0,

      openingBalanceLL: 0,
      periodDebitLL: 0,
      periodCreditLL: 0,
      balanceLL: 0,
      closingBalanceLL: 0,
    },
  );

  return {
    from: from ?? null,
    to: to ?? null,
    currency,      // echoed (request value), but math is USD + LL as above
    invoiceType,
    rows,
    totals,
  };
}








// Replace the getProfitability method in your reports.service.ts

async getProfitability(params: ProfitabilityParams) {
  const {
    from,
    to,
    customerId,
    itemVariantId,
    invoiceType = 'ALL',
  } = params;

  // ─── Auto-detect vatInclusive from active company ─────────────────────────
  const activeCompany = await this.companyService.getActiveCompany();
  const vatInclusive = activeCompany.vatInclusive;

  const qb = this.dataSource
    .createQueryBuilder()
    .from('invoices', 'inv')
    .leftJoin('customers', 'cust', 'inv.customerId = cust.id')
    .innerJoin('invoice_items', 'ii', 'ii.invoiceId = inv.id')
    .leftJoin('item_variant', 'v', 'ii.itemVariantId = v.id')
    .leftJoin('thickness', 'th', 'v.thicknessId = th.id')
    .leftJoin('item', 'item', 'th.itemId = item.id')
    .leftJoin('real_description', 'rd', 'v.realDescriptionId = rd.id')
    .select('inv.id', 'invoiceId')
    .addSelect('inv.invoiceNumber', 'invoiceNumber')
    .addSelect('inv.date', 'invoiceDate')
    .addSelect('inv.invoiceType', 'invoiceType')
    .addSelect('inv.vatPercentage', 'vatPercentage')        // ← NEW
    .addSelect('cust.id', 'customerId')
    .addSelect('cust.customerName', 'customerName')
    .addSelect('ii.id', 'invoiceItemId')
    .addSelect('ii.quantity', 'quantity')
    .addSelect('ii.sqm', 'sqm')
    .addSelect('ii.unitPrice', 'unitPrice')
    .addSelect('ii.totalAmount', 'totalAmount')
    .addSelect('ii.averageCost', 'averageCost')
    .addSelect('ii.sheetsPerBox', 'sheetsPerBox')
    .addSelect('ii.length', 'length')
    .addSelect('ii.width', 'width')
    .addSelect('v.id', 'itemVariantId')
    .addSelect('v.invoiceDisplayName', 'itemName')
    .addSelect('v.origin', 'origin')
    .addSelect('th.thickness', 'thickness')
    .addSelect('item.itemName', 'baseItemName')
    .addSelect('item.type', 'itemType')
    .addSelect('item.stockMode', 'stockMode')
    .addSelect('rd.sort_index_real_description', 'sortIndex')
    .addSelect('rd.categoryName', 'categoryName')
    .addSelect('rd.subCategory', 'subCategory')
    .addSelect('rd.colorName', 'colorName')
    .addSelect('rd.designName', 'designName');

  if (from) qb.andWhere('inv.date >= :from', { from });
  if (to) qb.andWhere('inv.date <= :to', { to });
  if (customerId) qb.andWhere('inv.customerId = :customerId', { customerId });
  if (itemVariantId) qb.andWhere('ii.itemVariantId = :itemVariantId', { itemVariantId });

  if (invoiceType !== 'ALL') {
    qb.andWhere('inv.invoiceType = :invoiceType', { invoiceType });
  } else {
    qb.andWhere('inv.invoiceType IN (:...types)', {
      types: ['S', 'G', 'RVR', 'RTN'],
    });
  }

  qb.orderBy('rd.sort_index_real_description IS NULL', 'ASC')
    .addOrderBy('rd.sort_index_real_description', 'ASC')
    .addOrderBy('inv.date', 'DESC')
    .addOrderBy('inv.id', 'DESC');

  const raw = await qb.getRawMany();

  // ─── Unit type helper ─────────────────────────────────────────────────────
  const getUnitType = (itemType: string, stockMode: string): string => {
    if (itemType === 'unit') return 'Unit';
    switch (stockMode) {
      case 'box':   return 'Box';
      case 'sheet': return 'Sheet';
      case 'sqm':
      default:      return 'SQM';
    }
  };

  // ─── VAT stripping helper ─────────────────────────────────────────────────
  /**
   * vatInclusive = false (e.g. Revo):
   *   → never strip, totalAmount is always net
   *
   * vatInclusive = true (e.g. Shamoun):
   *   → vatPercentage > 0: totalAmount is already ex-VAT (VAT added on top) → use as-is
   *   → vatPercentage = 0: totalAmount has 11% baked in → divide by 1.11 to get net
   */
  const computeNetRevenue = (totalAmount: number, vatPercentage: number): number => {
    if (!vatInclusive) return totalAmount;
    if (vatPercentage === 0) return totalAmount / 1.11;
    return totalAmount;
  };

  // ─── Map raw rows ─────────────────────────────────────────────────────────
  const rows = raw.map((r: any) => {
    const invType       = String(r.invoiceType || '');
    const isReturn      = invType === 'RTN';
    const vatPercentage = Number(r.vatPercentage || 0);
    const vatStripped   = vatInclusive && vatPercentage === 0;

    const stockMode = String(r.stockMode || 'sqm').toLowerCase();
    const itemType  = String(r.itemType  || '').toLowerCase();
    const mode      = itemType === 'unit' ? 'qty' : stockMode;

    const qty       = mode === 'qty' ? Number(r.quantity || 0) : Number(r.sqm || 0);
    const rawAmount = Number(r.totalAmount || 0);
    const revenue   = computeNetRevenue(rawAmount, vatPercentage);
    const avgCost   = Number(r.averageCost || 0);
    const cost      = avgCost * qty;

    let profit = revenue - cost;
    let margin = revenue !== 0 ? (profit / revenue) * 100 : 0;

    if (isReturn) {
      profit = -profit;
      margin = -margin;
    }

    const descParts = [r.categoryName, r.subCategory, r.colorName, r.designName].filter(Boolean);
    const fullDescription = descParts.length ? descParts.join(' | ') : '';

    const length       = r.length       ? Number(r.length)       : null;
    const width        = r.width        ? Number(r.width)        : null;
    const sheetsPerBox = r.sheetsPerBox ? Number(r.sheetsPerBox) : null;

    const dims = [];
    if (length) dims.push(`L:${length.toFixed(1)}`);
    if (width)  dims.push(`W:${width.toFixed(1)}`);
    const dimensions = dims.length ? dims.join(' × ') : '';

    const unitType = getUnitType(itemType, stockMode);

    return {
      invoiceId:     Number(r.invoiceId),
      invoiceNumber: String(r.invoiceNumber || ''),
      invoiceDate:   r.invoiceDate,
      invoiceType:   invType,
      customerId:    r.customerId ? Number(r.customerId) : null,
      customerName:  String(r.customerName || ''),

      itemVariantId:   r.itemVariantId ? Number(r.itemVariantId) : null,
      itemName:        String(r.itemName || r.baseItemName || ''),
      fullDescription,
      thickness:       r.thickness ? Number(r.thickness) : null,
      origin:          String(r.origin || ''),
      dimensions,
      length,
      width,
      sheetsPerBox,
      unitType,

      quantity:  Number(r.quantity || 0),
      sqm:       Number(r.sqm || 0),
      unitPrice: Number(r.unitPrice || 0),

      revenue:  Number(revenue.toFixed(2)),
      cost:     Number(cost.toFixed(2)),
      profit:   Number(profit.toFixed(2)),
      margin:   Number(margin.toFixed(2)),

      averageCost:  avgCost,
      stockMode:    mode,
      sortIndex:    r.sortIndex !== null ? Number(r.sortIndex) : null,

      vatPercentage,   // ← NEW
      vatStripped,     // ← NEW
    };
  });

  // ─── Totals ───────────────────────────────────────────────────────────────
  const totals = rows.reduce(
    (acc, row) => {
      acc.revenue += row.revenue;
      acc.cost    += row.cost;
      acc.profit  += row.profit;
      return acc;
    },
    { revenue: 0, cost: 0, profit: 0, margin: 0 },
  );
  totals.margin  = totals.revenue !== 0 ? Number(((totals.profit / totals.revenue) * 100).toFixed(2)) : 0;
  totals.revenue = Number(totals.revenue.toFixed(2));
  totals.cost    = Number(totals.cost.toFixed(2));
  totals.profit  = Number(totals.profit.toFixed(2));

  // ─── Group by customer ────────────────────────────────────────────────────
  const byCustomer = new Map<number, {
    customerId: number;
    customerName: string;
    revenue: number; cost: number; profit: number; margin: number;
    itemCount: number;
    items: Map<number, {
      itemVariantId: number; itemName: string; fullDescription: string;
      thickness: number | null; origin: string; dimensions: string;
      sheetsPerBox: number | null; unitType: string;
      revenue: number; cost: number; profit: number; margin: number;
      quantity: number; sqm: number; invoices: number[];
    }>;
  }>();

  for (const row of rows) {
    const custId = row.customerId || 0;
    if (!byCustomer.has(custId)) {
      byCustomer.set(custId, {
        customerId: custId, customerName: row.customerName,
        revenue: 0, cost: 0, profit: 0, margin: 0, itemCount: 0,
        items: new Map(),
      });
    }
    const custData = byCustomer.get(custId)!;
    custData.revenue += row.revenue;
    custData.cost    += row.cost;
    custData.profit  += row.profit;

    const varId = row.itemVariantId || 0;
    if (!custData.items.has(varId)) {
      custData.items.set(varId, {
        itemVariantId:   varId,
        itemName:        row.itemName,
        fullDescription: row.fullDescription,
        thickness:       row.thickness,
        origin:          row.origin,
        dimensions:      row.dimensions,
        sheetsPerBox:    row.sheetsPerBox,
        unitType:        row.unitType,
        revenue: 0, cost: 0, profit: 0, margin: 0,
        quantity: 0, sqm: 0, invoices: [],
      });
      custData.itemCount++;
    }
    const itemData = custData.items.get(varId)!;
    itemData.revenue  += row.revenue;
    itemData.cost     += row.cost;
    itemData.profit   += row.profit;
    itemData.quantity += row.quantity;
    itemData.sqm      += row.sqm;
    itemData.invoices.push(row.invoiceId);
  }

  const customerSummary = Array.from(byCustomer.values()).map((c) => {
    c.margin  = c.revenue !== 0 ? Number(((c.profit / c.revenue) * 100).toFixed(2)) : 0;
    c.revenue = Number(c.revenue.toFixed(2));
    c.cost    = Number(c.cost.toFixed(2));
    c.profit  = Number(c.profit.toFixed(2));
    const itemsArray = Array.from(c.items.values()).map((item) => {
      item.margin   = item.revenue !== 0 ? Number(((item.profit / item.revenue) * 100).toFixed(2)) : 0;
      item.revenue  = Number(item.revenue.toFixed(2));
      item.cost     = Number(item.cost.toFixed(2));
      item.profit   = Number(item.profit.toFixed(2));
      item.quantity = Number(item.quantity.toFixed(2));
      item.sqm      = Number(item.sqm.toFixed(2));
      return item;
    });
    return { ...c, items: itemsArray };
  });

  // ─── Group by item variant ────────────────────────────────────────────────
  const byItem = new Map<number, {
    itemVariantId: number; itemName: string; fullDescription: string;
    thickness: number | null; origin: string; dimensions: string;
    sheetsPerBox: number | null; unitType: string;
    revenue: number; cost: number; profit: number; margin: number;
    quantity: number; sqm: number;
    customerCount: number; invoiceCount: number; sortIndex: number | null;
    customers: Map<number, {
      customerId: number; customerName: string;
      revenue: number; cost: number; profit: number; margin: number;
      quantity: number; sqm: number;
    }>;
  }>();

  for (const row of rows) {
    const varId = row.itemVariantId || 0;
    if (!byItem.has(varId)) {
      byItem.set(varId, {
        itemVariantId:   varId,
        itemName:        row.itemName,
        fullDescription: row.fullDescription,
        thickness:       row.thickness,
        origin:          row.origin,
        dimensions:      row.dimensions,
        sheetsPerBox:    row.sheetsPerBox,
        unitType:        row.unitType,
        revenue: 0, cost: 0, profit: 0, margin: 0,
        quantity: 0, sqm: 0,
        customerCount: 0, invoiceCount: 0,
        sortIndex: row.sortIndex,
        customers: new Map(),
      });
    }
    const itemData = byItem.get(varId)!;
    itemData.revenue      += row.revenue;
    itemData.cost         += row.cost;
    itemData.profit       += row.profit;
    itemData.quantity     += row.quantity;
    itemData.sqm          += row.sqm;
    itemData.invoiceCount++;

    const custId = row.customerId || 0;
    if (!itemData.customers.has(custId)) {
      itemData.customers.set(custId, {
        customerId: custId, customerName: row.customerName,
        revenue: 0, cost: 0, profit: 0, margin: 0, quantity: 0, sqm: 0,
      });
      itemData.customerCount++;
    }
    const custData = itemData.customers.get(custId)!;
    custData.revenue  += row.revenue;
    custData.cost     += row.cost;
    custData.profit   += row.profit;
    custData.quantity += row.quantity;
    custData.sqm      += row.sqm;
  }

  const itemSummary = Array.from(byItem.values())
    .map((item) => {
      item.margin   = item.revenue !== 0 ? Number(((item.profit / item.revenue) * 100).toFixed(2)) : 0;
      item.revenue  = Number(item.revenue.toFixed(2));
      item.cost     = Number(item.cost.toFixed(2));
      item.profit   = Number(item.profit.toFixed(2));
      item.quantity = Number(item.quantity.toFixed(2));
      item.sqm      = Number(item.sqm.toFixed(2));
      const customersArray = Array.from(item.customers.values()).map((cust) => {
        cust.margin   = cust.revenue !== 0 ? Number(((cust.profit / cust.revenue) * 100).toFixed(2)) : 0;
        cust.revenue  = Number(cust.revenue.toFixed(2));
        cust.cost     = Number(cust.cost.toFixed(2));
        cust.profit   = Number(cust.profit.toFixed(2));
        cust.quantity = Number(cust.quantity.toFixed(2));
        cust.sqm      = Number(cust.sqm.toFixed(2));
        return cust;
      });
      return { ...item, customers: customersArray };
    })
    .sort((a, b) => {
      const aIdx = a.sortIndex !== null ? a.sortIndex : Number.POSITIVE_INFINITY;
      const bIdx = b.sortIndex !== null ? b.sortIndex : Number.POSITIVE_INFINITY;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return b.profit - a.profit;
    });

  // ─── Group by invoice ─────────────────────────────────────────────────────
  const byInvoice = new Map<number, {
    invoiceId: number; invoiceNumber: string; invoiceDate: any;
    invoiceType: string; customerId: number | null; customerName: string;
    revenue: number; cost: number; profit: number; margin: number;
    itemCount: number;
    items: {
      itemVariantId: number | null; itemName: string; fullDescription: string;
      thickness: number | null; origin: string; dimensions: string;
      sheetsPerBox: number | null; unitType: string;
      quantity: number; sqm: number; unitPrice: number; averageCost: number;
      revenue: number; cost: number; profit: number; margin: number;
      stockMode: string;
      vatPercentage: number; vatStripped: boolean;  // ← NEW
    }[];
  }>();

  for (const row of rows) {
    if (!byInvoice.has(row.invoiceId)) {
      byInvoice.set(row.invoiceId, {
        invoiceId:     row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        invoiceDate:   row.invoiceDate,
        invoiceType:   row.invoiceType,
        customerId:    row.customerId,
        customerName:  row.customerName,
        revenue: 0, cost: 0, profit: 0, margin: 0, itemCount: 0,
        items: [],
      });
    }
    const invData = byInvoice.get(row.invoiceId)!;
    invData.revenue += row.revenue;
    invData.cost    += row.cost;
    invData.profit  += row.profit;
    invData.itemCount++;

    invData.items.push({
      itemVariantId:   row.itemVariantId,
      itemName:        row.itemName,
      fullDescription: row.fullDescription,
      thickness:       row.thickness,
      origin:          row.origin,
      dimensions:      row.dimensions,
      sheetsPerBox:    row.sheetsPerBox,
      unitType:        row.unitType,
      quantity:        row.quantity,
      sqm:             row.sqm,
      unitPrice:       row.unitPrice,
      averageCost:     row.averageCost,
      revenue:         row.revenue,
      cost:            row.cost,
      profit:          row.profit,
      margin:          row.margin,
      stockMode:       row.stockMode,
      vatPercentage:   row.vatPercentage,  // ← NEW
      vatStripped:     row.vatStripped,    // ← NEW
    });
  }

  const invoiceSummary = Array.from(byInvoice.values())
    .map((inv) => ({
      ...inv,
      margin:  inv.revenue !== 0 ? Number(((inv.profit / inv.revenue) * 100).toFixed(2)) : 0,
      revenue: Number(inv.revenue.toFixed(2)),
      cost:    Number(inv.cost.toFixed(2)),
      profit:  Number(inv.profit.toFixed(2)),
      items:   inv.items.map((item) => ({
        ...item,
        revenue:  Number(item.revenue.toFixed(2)),
        cost:     Number(item.cost.toFixed(2)),
        profit:   Number(item.profit.toFixed(2)),
        quantity: Number(item.quantity.toFixed(2)),
        sqm:      Number(item.sqm.toFixed(2)),
      })),
    }))
    .sort((a, b) => {
      const dateDiff = new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime();
      if (dateDiff !== 0) return dateDiff;
      return b.invoiceId - a.invoiceId;
    });

  return {
    from:          from ?? null,
    to:            to ?? null,
    customerId:    customerId ?? null,
    itemVariantId: itemVariantId ?? null,
    invoiceType,
    vatInclusive,   // ← echoed back so frontend knows which mode was applied
    rows,
    totals,
    count: rows.length,
    customerSummary,
    itemSummary,
    invoiceSummary,
  };
}

async getTopCustomers(params: {
  from?: string | null;
  to?: string | null;
  limit?: number | null;
  invoiceType?: 'S' | 'RVR' | 'BOTH' | null;
}) {
  const { from, to, limit, invoiceType = 'BOTH' } = params;

  const types = invoiceType === 'S' ? ['S'] : invoiceType === 'RVR' ? ['RVR'] : ['S', 'RVR'];

  const qb = this.dataSource
    .createQueryBuilder()
    .from('invoices', 'inv')
    .leftJoin('customers', 'cust', 'inv.customerId = cust.id')
    .select('cust.id', 'customerId')
    .addSelect('cust.customerName', 'customerName')
    .addSelect('cust.financialNumber', 'financialNumber')
    .addSelect('SUM(inv.grandTotal)', 'grandTotal')
    .addSelect('COUNT(inv.id)', 'invoiceCount')
    .where('inv.invoiceType IN (:...types)', { types })
    .andWhere('cust.id IS NOT NULL')
    .groupBy('cust.id')
    .addGroupBy('cust.customerName')
    .addGroupBy('cust.financialNumber')
    .orderBy('grandTotal', 'DESC');

  if (from) qb.andWhere('inv.date >= :from', { from });
  if (to)   qb.andWhere('inv.date <= :to',   { to });
  if (limit && limit > 0) qb.limit(limit);

  const raw = await qb.getRawMany();

  return raw.map((r: any) => ({
    customerName:    String(r.customerName    || ''),
    financialNumber: String(r.financialNumber || '—'),
    grandTotal:      Number(Number(r.grandTotal   || 0).toFixed(2)),
    invoiceCount:    Number(r.invoiceCount    || 0),
  }));
}

async getProfitabilityByMonth(params: ProfitabilityParams) {
  const {
    from,
    to,
    customerId,
    invoiceType = 'ALL',
  } = params;

  // ─── Auto-detect vatInclusive from active company ─────────────────────────
  const activeCompany = await this.companyService.getActiveCompany();
  const vatInclusive = activeCompany.vatInclusive;

  // ─── VAT stripping helper ─────────────────────────────────────────────────
  const computeNetRevenue = (totalAmount: number, vatPercentage: number): number => {
    if (!vatInclusive) return totalAmount;
    if (vatPercentage === 0) return totalAmount / 1.11;
    return totalAmount;
  };

  // ─── Query: aggregate per invoice (SUM items) ─────────────────────────────
  const qb = this.dataSource
    .createQueryBuilder()
    .from('invoices', 'inv')
    .leftJoin('customers', 'cust', 'inv.customerId = cust.id')
    .innerJoin('invoice_items', 'ii', 'ii.invoiceId = inv.id')
    .leftJoin('item_variant', 'v', 'ii.itemVariantId = v.id')
    .leftJoin('thickness', 'th', 'v.thicknessId = th.id')
    .leftJoin('item', 'item', 'th.itemId = item.id')
    .select('inv.id', 'invoiceId')
    .addSelect('inv.invoiceNumber', 'invoiceNumber')
    .addSelect('inv.date', 'invoiceDate')
    .addSelect('inv.invoiceType', 'invoiceType')
    .addSelect('inv.vatPercentage', 'vatPercentage')
    .addSelect('cust.id', 'customerId')
    .addSelect('cust.customerName', 'customerName')
    .addSelect('SUM(ii.totalAmount)', 'totalAmount')
    .addSelect(
      `SUM(
        CASE
          WHEN item.type = 'unit' THEN ii.averageCost * ii.quantity
          WHEN item.stockMode = 'box'   THEN ii.averageCost * ii.sqm
          WHEN item.stockMode = 'sheet' THEN ii.averageCost * ii.sqm
          ELSE ii.averageCost * ii.sqm
        END
      )`,
      'totalCost',
    )
    .addSelect('COUNT(ii.id)', 'itemCount')
    .groupBy('inv.id')
    .addGroupBy('inv.invoiceNumber')
    .addGroupBy('inv.date')
    .addGroupBy('inv.invoiceType')
    .addGroupBy('inv.vatPercentage')
    .addGroupBy('cust.id')
    .addGroupBy('cust.customerName');

  if (from) qb.andWhere('inv.date >= :from', { from });
  if (to)   qb.andWhere('inv.date <= :to',   { to });
  if (customerId) qb.andWhere('inv.customerId = :customerId', { customerId });

  if (invoiceType !== 'ALL') {
    qb.andWhere('inv.invoiceType = :invoiceType', { invoiceType });
  } else {
    qb.andWhere('inv.invoiceType IN (:...types)', {
      types: ['S', 'G', 'RVR', 'RTN'],
    });
  }

  qb.orderBy('inv.date', 'ASC').addOrderBy('inv.id', 'ASC');

  const raw = await qb.getRawMany();

  // ─── Map raw rows into invoice-level records ──────────────────────────────
  const invoiceRows: InvoiceRow[] = raw.map((r: any) => {
    const invType       = String(r.invoiceType || '');
    const isReturn      = invType === 'RTN';
    const vatPercentage = Number(r.vatPercentage || 0);
    const vatStripped   = vatInclusive && vatPercentage === 0;

    const rawAmount = Number(r.totalAmount || 0);
    const revenue   = computeNetRevenue(rawAmount, vatPercentage);
    const cost      = Number(r.totalCost || 0);

    let profit = revenue - cost;
    let margin = revenue !== 0 ? (profit / revenue) * 100 : 0;

    if (isReturn) {
      profit = -profit;
      margin = -margin;
    }

    // ─── Normalize invoiceDate to YYYY-MM-DD string ───────────────────────
    let invoiceDate = '';
    if (r.invoiceDate instanceof Date) {
      invoiceDate = r.invoiceDate.toISOString().slice(0, 10);
    } else if (r.invoiceDate) {
      invoiceDate = String(r.invoiceDate).slice(0, 10);
    }

    return {
      invoiceId:     Number(r.invoiceId),
      invoiceNumber: String(r.invoiceNumber || ''),
      invoiceDate,
      invoiceType:   invType,
      customerId:    r.customerId ? Number(r.customerId) : null,
      customerName:  String(r.customerName || ''),
      itemCount:     Number(r.itemCount || 0),
      revenue:       Number(revenue.toFixed(2)),
      cost:          Number(cost.toFixed(2)),
      profit:        Number(profit.toFixed(2)),
      margin:        Number(margin.toFixed(2)),
      vatPercentage,
      vatStripped,
    };
  });

  // ─── Group by month ───────────────────────────────────────────────────────
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const monthMap = new Map<string, MonthGroup>();

  for (const row of invoiceRows) {
    // Use Date object to safely parse any format
    const dateObj = new Date(row.invoiceDate);
    const year    = dateObj.getFullYear();
    const month   = dateObj.getMonth() + 1; // getMonth() is 0-based → 1-12
    const key     = `${year}-${String(month).padStart(2, '0')}`;

    // Guard against invalid dates
    if (isNaN(year) || isNaN(month)) continue;

    if (!monthMap.has(key)) {
      monthMap.set(key, {
        year,
        month,
        monthLabel: `${monthNames[month - 1]} ${year}`,
        invoices: [],
        totals: { revenue: 0, cost: 0, profit: 0, margin: 0, invoiceCount: 0 },
      });
    }

    const group = monthMap.get(key)!;
    group.invoices.push(row);
    group.totals.revenue      += row.revenue;
    group.totals.cost         += row.cost;
    group.totals.profit       += row.profit;
    group.totals.invoiceCount++;
  }

  // ─── Finalize month totals (round + margin) ───────────────────────────────
  const months = Array.from(monthMap.values())
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    })
    .map((g) => ({
      ...g,
      totals: {
        ...g.totals,
        revenue: Number(g.totals.revenue.toFixed(2)),
        cost:    Number(g.totals.cost.toFixed(2)),
        profit:  Number(g.totals.profit.toFixed(2)),
        margin:  g.totals.revenue !== 0
          ? Number(((g.totals.profit / g.totals.revenue) * 100).toFixed(2))
          : 0,
      },
    }));

  // ─── Grand total ──────────────────────────────────────────────────────────
  const grandTotal = invoiceRows.reduce(
    (acc, row) => {
      acc.revenue      += row.revenue;
      acc.cost         += row.cost;
      acc.profit       += row.profit;
      acc.invoiceCount++;
      return acc;
    },
    { revenue: 0, cost: 0, profit: 0, margin: 0, invoiceCount: 0 },
  );
  grandTotal.margin  = grandTotal.revenue !== 0
    ? Number(((grandTotal.profit / grandTotal.revenue) * 100).toFixed(2))
    : 0;
  grandTotal.revenue = Number(grandTotal.revenue.toFixed(2));
  grandTotal.cost    = Number(grandTotal.cost.toFixed(2));
  grandTotal.profit  = Number(grandTotal.profit.toFixed(2));

  return {
    from:        from ?? null,
    to:          to   ?? null,
    customerId:  customerId ?? null,
    invoiceType,
    vatInclusive,
    months,
    grandTotal,
  };
}

// ─── Cost Diagnostic ────────────────────────────────────────────────────────

async getCostDiagnostic(params: { from: string; to: string }) {
  const { from, to } = params;

  // 1) Find all variants that have sales with averageCost = 0 or null in the date range
  const zeroCostRows = await this.dataSource
    .createQueryBuilder()
    .from('invoices', 'inv')
    .innerJoin('invoice_items', 'ii', 'ii.invoiceId = inv.id')
    .leftJoin('item_variant', 'v', 'v.id = ii.itemVariantId')
    .leftJoin('thickness', 'th', 'v.thicknessId = th.id')
    .leftJoin('item', 'item', 'item.id = th.itemId')
    .select('ii.itemVariantId', 'variantId')
    .addSelect('v.invoiceDisplayName', 'itemName')
    .addSelect('item.itemName', 'baseItemName')
    .addSelect('item.type', 'itemType')
    .addSelect('item.stockMode', 'stockMode')
    .addSelect('COUNT(*)', 'zeroCostSales')
    .addSelect(
      `SUM(CASE WHEN item.type = 'unit' OR item.stockMode = 'QTY' THEN ii.quantity ELSE ii.sqm END)`,
      'totalQtySold',
    )
    .addSelect('MIN(inv.date)', 'firstZeroSaleDate')
    .addSelect('MAX(inv.date)', 'lastZeroSaleDate')
    .where('inv.date >= :from', { from })
    .andWhere('inv.date <= :to', { to })
    .andWhere('inv.invoiceType IN (:...types)', { types: ['S', 'G', 'RVR'] })
    .andWhere('(ii.averageCost IS NULL OR ii.averageCost = 0)')
    .groupBy('ii.itemVariantId')
    .addGroupBy('v.invoiceDisplayName')
    .addGroupBy('item.itemName')
    .addGroupBy('item.type')
    .addGroupBy('item.stockMode')
    .orderBy('COUNT(*)', 'DESC')
    .getRawMany();

  const items: any[] = [];

  for (const row of zeroCostRows) {
    const variantId = Number(row.variantId);
    const firstZeroSaleDate = row.firstZeroSaleDate
      ? String(row.firstZeroSaleDate).slice(0, 10)
      : null;

    // 2) Purchase invoice history
    const purchases = await this.dataSource
      .createQueryBuilder()
      .from('purchase_invoice_items', 'pii')
      .innerJoin('purchase_invoices', 'pi', 'pi.id = pii.invoiceId')
      .select('pi.id', 'invoiceId')
      .addSelect('pi.date', 'date')
      .addSelect('pi.status', 'status')
      .addSelect('pii.sqmOfr', 'sqmOfr')
      .addSelect('pii.sqm', 'sqm')
      .addSelect('pii.quantity', 'quantity')
      .addSelect('pii.finalOFR', 'finalOFR')
      .addSelect('pii.totalOFR', 'totalOFR')
      .addSelect('pii.totalAmount', 'totalAmount')
      .addSelect('pii.averageCost', 'averageCost')
      .where('pii.itemVariantId = :vid', { vid: variantId })
      .orderBy('pi.date', 'ASC')
      .addOrderBy('pi.id', 'ASC')
      .getRawMany();

    // 3) Last cost event before first zero-cost sale
    const lastTxRaw = firstZeroSaleDate
      ? await this.dataSource
          .createQueryBuilder()
          .from('inventory_transactions', 'tx')
          .select('tx.id', 'id')
          .addSelect('tx.transactionType', 'transactionType')
          .addSelect('tx.dateForEachInvoice', 'txDate')
          .addSelect('tx.purchaseInvoiceItemId', 'purchaseInvoiceItemId')
          .addSelect('tx.transferId', 'transferId')
          .addSelect('tx.inventoryCountId', 'inventoryCountId')
          .addSelect('tx.itemBatchId', 'itemBatchId')
          .where('tx.itemVariantId = :vid', { vid: variantId })
          .andWhere('tx.dateForEachInvoice IS NOT NULL')
          .andWhere('tx.dateForEachInvoice <= :cut', { cut: firstZeroSaleDate })
          .andWhere(
            '(tx.purchaseInvoiceItemId IS NOT NULL OR tx.transferId IS NOT NULL OR tx.inventoryCountId IS NOT NULL)',
          )
          .orderBy('tx.dateForEachInvoice', 'DESC')
          .addOrderBy('tx.id', 'DESC')
          .limit(1)
          .getRawOne()
      : null;

    // 4) All transfer events for this variant
    const transferRows = await this.dataSource
      .createQueryBuilder()
      .from('inventory_transactions', 'tx')
      .innerJoin('transfers', 'tr', 'tr.id = tx.transferId')
      .leftJoin(
        'transfer_items',
        'ti',
        'ti.transferId = tx.transferId AND ti.itemBatchId = tx.itemBatchId',
      )
      .select('tr.id', 'transferId')
      .addSelect('tr.date', 'date')
      .addSelect('tr.location', 'location')
      .addSelect('tx.transactionType', 'txType')
      .addSelect('tx.dateForEachInvoice', 'txDate')
      .addSelect('ti.averageCost', 'averageCost')
      .addSelect('ti.averageCostVM', 'averageCostVM')
      .where('tx.itemVariantId = :vid', { vid: variantId })
      .andWhere('tx.transferId IS NOT NULL')
      .orderBy('tr.date', 'ASC')
      .addOrderBy('tx.id', 'ASC')
      .getRawMany();

    // 5) Classify root cause
    const receivedPurchases = purchases.filter((p: any) => p.status === 'Recieved');
    const firstPurchaseDate =
      receivedPurchases.length > 0
        ? String(receivedPurchases[0].date).slice(0, 10)
        : null;

    const lastEventType = lastTxRaw
      ? lastTxRaw.transferId
        ? 'transfer'
        : lastTxRaw.purchaseInvoiceItemId
          ? 'purchase'
          : 'count'
      : null;

    let cause: string;
    let causeLabel: string;

    if (purchases.length === 0 && transferRows.length === 0) {
      cause = 'no_stock_events';
      causeLabel = 'No purchase invoices and no transfers found — no cost data exists';
    } else if (purchases.length === 0) {
      cause = 'no_purchases';
      causeLabel = 'No purchase invoices — stock came in via transfer or count only';
    } else if (receivedPurchases.length === 0) {
      cause = 'no_received_purchases';
      causeLabel = 'Purchase invoices exist but none have "Received" status';
    } else if (
      firstZeroSaleDate &&
      firstPurchaseDate &&
      firstZeroSaleDate < firstPurchaseDate
    ) {
      cause = 'sold_before_purchased';
      causeLabel = 'Item was sold before the first received purchase invoice';
    } else if (lastEventType === 'transfer') {
      // Last event before the sale was a transfer — check if its cost is 0
      const lastTransferCost = transferRows.find(
        (t: any) => String(t.transferId) === String(lastTxRaw?.transferId),
      );
      const transferAvg = lastTransferCost?.averageCost != null
        ? Number(lastTransferCost.averageCost)
        : null;

      cause = 'transfer_cost_zero';
      causeLabel =
        transferAvg != null && transferAvg > 0
          ? `Last event before sale was a transfer (ID ${lastTxRaw?.transferId}) with averageCost = ${transferAvg} — snapshot should have used this value`
          : `Last event before sale was a transfer (ID ${lastTxRaw?.transferId}) with averageCost = 0 or null — transfer cost was never set`;
    } else {
      const allSqmZero = receivedPurchases.every((p: any) => Number(p.sqmOfr ?? 0) === 0);
      const hasQuantity = receivedPurchases.some((p: any) => Number(p.quantity ?? 0) > 0);
      const isUnitItem = allSqmZero && hasQuantity;

      const allOFRMissing = receivedPurchases.every(
        (p: any) => !p.finalOFR || Number(p.finalOFR) === 0,
      );
      const someOFRMissing = receivedPurchases.some(
        (p: any) => !p.finalOFR || Number(p.finalOFR) === 0,
      );

      if (isUnitItem && allOFRMissing) {
        cause = 'unit_item_cost_zero';
        causeLabel = 'Unit item: all purchases have OFR cost = 0 (recompute needed)';
      } else if (allOFRMissing) {
        cause = 'all_ofr_missing';
        causeLabel = 'All purchase invoices have finalOFR = 0 (OFR price never entered)';
      } else if (someOFRMissing) {
        cause = 'partial_ofr_missing';
        causeLabel =
          'Some purchases have finalOFR = 0 — diluting the running average toward 0';
      } else if (!lastTxRaw) {
        cause = 'no_transactions';
        causeLabel =
          'Purchases exist but no inventory transactions were found — recompute may not have run for this item';
      } else {
        cause = 'unknown';
        causeLabel =
          'Purchases have valid OFR prices and last event is a purchase — needs deeper investigation';
      }
    }

    items.push({
      variantId,
      itemName: row.itemName || row.baseItemName || `Variant #${variantId}`,
      itemType: row.itemType ?? null,
      stockMode: row.stockMode ?? null,
      zeroCostSales: Number(row.zeroCostSales),
      totalQtySold: Number(row.totalQtySold ?? 0),
      firstZeroSaleDate: row.firstZeroSaleDate ?? null,
      lastZeroSaleDate: row.lastZeroSaleDate ?? null,
      firstPurchaseDate,
      lastEvent: lastTxRaw
        ? {
            type: lastEventType,
            date: lastTxRaw.txDate ? String(lastTxRaw.txDate).slice(0, 10) : null,
            transferId: lastTxRaw.transferId ?? null,
            purchaseInvoiceItemId: lastTxRaw.purchaseInvoiceItemId ?? null,
          }
        : null,
      cause,
      causeLabel,
      purchases: purchases.map((p: any) => ({
        invoiceId: Number(p.invoiceId),
        date: p.date,
        status: p.status,
        sqmOfr: Number(p.sqmOfr ?? 0),
        sqm: Number(p.sqm ?? 0),
        quantity: Number(p.quantity ?? 0),
        finalOFR: Number(p.finalOFR ?? 0),
        totalOFR: Number(p.totalOFR ?? 0),
        totalAmount: Number(p.totalAmount ?? 0),
        averageCost: p.averageCost != null ? Number(p.averageCost) : null,
      })),
      transfers: transferRows.map((t: any) => ({
        transferId: Number(t.transferId),
        date: t.date,
        location: t.location ?? null,
        txType: t.txType,
        averageCost: t.averageCost != null ? Number(t.averageCost) : null,
        averageCostVM: t.averageCostVM != null ? Number(t.averageCostVM) : null,
      })),
    });
  }

  return {
    from,
    to,
    totalZeroCostItems: items.length,
    items,
  };
}

}