import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Account } from '../entities/account.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { AccountRoleMap } from "../entities/accountRoleMap.entity";
import { Customer } from '../entities/customer.entity';
import { Supplier } from '../entities/supplier.entity';
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

@Injectable()
export class ReportsService {
  constructor(
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


}