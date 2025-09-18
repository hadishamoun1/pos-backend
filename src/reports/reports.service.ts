import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Account } from '../entities/account.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';

type TrialBalanceParams = {
  from?: string | null;
  to?: string | null;
  /** “level = N” => start displaying from codes whose DIGIT length = N, then descend */
  level?: number;
  currency?: 'USD' | 'LL' | 'EURO' | 'BASE';
  invoiceType?: 'ALL' | 'S' | 'G';
  mainFrom?: string | null;
  mainTo?: string | null;
  subFrom?: string | null;
  subTo?: string | null;
  mainPrefixes?: string; // e.g. "601,705"
};

/* ===== Tree node types ===== */
interface TBNodeSum {
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

interface TBNode {
  keyDigits: string;         // digits only key (used for level and ordering)
  code: string;              // accountNumber (exact, as in DB)
  name: string;              // accountName
  parentCode?: string;       // parent's accountNumber (exact)
  children: Set<string>;     // children by accountNumber
  sum: TBNodeSum;            // rolled numbers
  leafHasActivity: boolean;  // this account itself has activity
  depth: number;             // depth by parent chain (root=1, child=2, ...)
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
  ) {}

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

  /**
   * Prefix-band: compare only first N digits where N = max(len(from), len(to)).
   */
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


    /** ALWAYS base columns (no OFR): used by the **Standard** endpoint */
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


  /** OFR aware (used by the existing hierarchical endpoint) */
  private getColsFor(rowKind: 'S' | 'G', currency: 'USD' | 'LL' | 'EURO' | 'BASE') {
    if (rowKind === 'G') {
      const ofr = {
        USD: { dr: 'drUSDOFR', cr: 'crUSDOFR' },
        LL: { dr: 'drLLOFR', cr: 'crLLOFR' },
        EURO: { dr: 'drOFR', cr: 'crOFR' },
        BASE: { dr: 'drOFR', cr: 'crOFR' },
      } as const;
      const p = ofr[currency] ?? ofr.USD;
      return { drCol: p.dr as keyof JournalVoucherDetail, crCol: p.cr as keyof JournalVoucherDetail } as const;
    }
    return this.getBaseCols(currency);
  }
/** Lexicographic compare on digits-only strings (prefix-friendly order). */
private cmpLexDigits(a: string, b: string) {
  const A = this.digits(a);
  const B = this.digits(b);
  return A.localeCompare(B, undefined, { numeric: false, sensitivity: 'base' });
}
  

  // Build a rollup tree using REAL parent chain (`parentNumber`). We:
  // 1) Create a node for each active leaf and all its ancestors up to the root.
  // 2) Add leaf sums to the leaf, then roll them up through parentNumber to the highest parent.
  // 3) Sort children by numeric account number (string compare numeric=true).
  private buildTreeAndRollup(
    activeLeafSums: Map<string, TBNodeSum>,         // accountNumber -> sums (only active leaves)
    accountsByCode: Map<string, Account>,          // accountNumber -> Account
  ) {
    const nodes = new Map<string, TBNode>();

    const ensureNode = (acc: Account): TBNode => {
      const code = String(acc.accountNumber);
      const ex = nodes.get(code);
      if (ex) return ex;
      const n: TBNode = {
        keyDigits: this.digits(code),
        code,
        name: String(acc.accountName ?? ''),
        parentCode: acc.parentNumber ?? undefined,
        children: new Set<string>(),
        sum: { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
        leafHasActivity: false,
        depth: 1, // will be updated
      };
      nodes.set(code, n);
      return n;
    };

    // Create nodes for leaves and ancestors; attach leaf sums; then roll upward.
    for (const [leafCode, sums] of activeLeafSums) {
      const startAcc = accountsByCode.get(leafCode);
      if (!startAcc) continue;

      // Upward chain (create nodes and link parent->children)
      let acc: Account | undefined = startAcc;
      let prevCode: string | undefined;
      const chain: string[] = [];
      while (acc) {
        const code = String(acc.accountNumber);
        chain.push(code);

        const node = ensureNode(acc);
        if (prevCode) {
          // link parent->child
          node.children.add(prevCode);
          const child = nodes.get(prevCode)!;
          child.parentCode = code;
        }
        prevCode = code;

        if (!acc.parentNumber) break;
        acc = accountsByCode.get(acc.parentNumber);
        if (!acc) break; // broken parent link → stop here
      }

      // Add sums to the leaf itself
      const leafNode = nodes.get(leafCode)!;
      leafNode.leafHasActivity = true;
      leafNode.sum.openingBalance += sums.openingBalance;
      leafNode.sum.periodDebit += sums.periodDebit;
      leafNode.sum.periodCredit += sums.periodCredit;
      leafNode.sum.closingBalance += sums.closingBalance;

      // Roll up the same sums to all ancestors in the chain (excluding the leaf we already updated, but idempotent if included)
      for (let i = 1; i < chain.length; i++) {
        const anc = nodes.get(chain[i])!;
        anc.sum.openingBalance += sums.openingBalance;
        anc.sum.periodDebit += sums.periodDebit;
        anc.sum.periodCredit += sums.periodCredit;
        anc.sum.closingBalance += sums.closingBalance;
      }
    }

    // Compute depth by walking up parent chain
    const depthOf = (code: string): number => {
      let d = 1;
      let cur = nodes.get(code);
      while (cur?.parentCode) {
        d += 1;
        cur = nodes.get(cur.parentCode);
      }
      return d;
    };
    for (const n of nodes.values()) n.depth = depthOf(n.code);

    // Sort children for every node
    const sortChildren = (n: TBNode) => {
      n.children = new Set(
        Array.from(n.children).sort((a, b) => this.cmp(a, b)), // numeric-aware compare on accountNumber
      );
    };
    for (const n of nodes.values()) sortChildren(n);

    // Roots = nodes with no parent in the built set
    const roots = Array.from(nodes.values())
      .filter((n) => !n.parentCode || !nodes.has(n.parentCode))
      .sort((a, b) => this.cmp(a.code, b.code));

    return { nodes, roots };
  }

  // Preorder traversal starting at the first digit-length >= requested level.
  private preorderFromDigitLevel(nodes: Map<string, TBNode>, roots: TBNode[], requestedLevel: number) {
    const lengths = new Set<number>(Array.from(nodes.values()).map((n) => n.keyDigits.length));
    let startLen = Math.max(1, Number(requestedLevel || 1));
    const maxLen = Math.max(...Array.from(lengths));
    while (!lengths.has(startLen) && startLen < maxLen) startLen += 1;
    if (!lengths.has(startLen)) startLen = Math.min(...Array.from(lengths)); // fallback (shouldn't happen)

    // Starting nodes are those whose DIGIT length == startLen
    const starts = Array.from(nodes.values())
      .filter((n) => n.keyDigits.length === startLen)
      .sort((a, b) => this.cmp(a.code, b.code));

    const order: TBNode[] = [];
    const dfs = (n: TBNode) => {
      order.push(n);
      for (const childCode of n.children) {
        const ch = nodes.get(childCode)!;
        dfs(ch);
      }
    };
    for (const s of starts) dfs(s);

    return order;
  }

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

    // 1) Load accounts (need parentNumber and names)
    const accounts = await this.accountRepo.find({
      select: ['id', 'accountNumber', 'accountName', 'parentNumber'],
    });
    const accountsByCode = new Map<string, Account>(accounts.map((a) => [String(a.accountNumber), a]));

    // 2) Selection by bands / prefixes (to decide which accounts' activity to include)
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

    // 3) Helper to filter JV rows by invoiceType
    const applyTypeFilter = (qb: ReturnType<typeof this.jvdRepo.createQueryBuilder>) => {
      if (invoiceType === 'S') {
        qb.andWhere('(jv.jvType = :tS OR d.docNbr LIKE :sPrefix)', { tS: 'S', sPrefix: 'S%' });
      } else if (invoiceType === 'G') {
        qb.andWhere('(jv.jvType = :tG OR d.docNbr LIKE :gPrefix)', { tG: 'G', gPrefix: 'G%' });
      }
      return qb;
    };

    // 4) Opening rows (strictly before "from")
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

    // 5) Period rows (between from..to, honoring missing bounds)
    const periodQb = this.jvdRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.journalVoucher', 'jv')
      .leftJoinAndSelect('d.account', 'acc')
      .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) });
    if (from) periodQb.andWhere('jv.date >= :from', { from });
    if (to) periodQb.andWhere('jv.date <= :to', { to });
    applyTypeFilter(periodQb);
    const periodRows = await periodQb.getMany();

    // 6) Aggregate by accountId (direct activity per account)
    const pickCols = (r: JournalVoucherDetail) => {
      const isG = r.journalVoucher?.jvType === 'G' || (r.docNbr?.startsWith('G') ?? false);
      const { drCol, crCol } = this.getColsFor(isG ? 'G' : 'S', currency);
      return {
        debit: Number((r as any)[drCol] || 0),
        credit: Number((r as any)[crCol] || 0),
      };
    };

    const openingByAcc = new Map<number, { debit: number; credit: number }>();
    for (const r of openingRows) {
      const prev = openingByAcc.get(r.accountId) ?? { debit: 0, credit: 0 };
      const { debit, credit } = pickCols(r);
      prev.debit += debit;
      prev.credit += credit;
      openingByAcc.set(r.accountId, prev);
    }

    const periodByAcc = new Map<number, { debit: number; credit: number }>();
    for (const r of periodRows) {
      const prev = periodByAcc.get(r.accountId) ?? { debit: 0, credit: 0 };
      const { debit, credit } = pickCols(r);
      prev.debit += debit;
      prev.credit += credit;
      periodByAcc.set(r.accountId, prev);
    }

    // 7) Active accounts (any opening or period activity)
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

    // 8) Leaf sums by accountNumber for selected+active accounts
    const activeLeafSums = new Map<string, TBNodeSum>(); // accountNumber -> sums
    for (const acc of selected) {
      if (!activeIds.has(acc.id)) continue;
      const op = openingByAcc.get(acc.id) ?? { debit: 0, credit: 0 };
      const pr = periodByAcc.get(acc.id) ?? { debit: 0, credit: 0 };
      const openingBalance = op.debit - op.credit;
      const closingBalance = openingBalance + (pr.debit - pr.credit);

      activeLeafSums.set(String(acc.accountNumber), {
        openingBalance,
        periodDebit: pr.debit,
        periodCredit: pr.credit,
        closingBalance,
      });
    }

    // 9) Build REAL-parent tree, roll sums up to highest parent
    const { nodes, roots } = this.buildTreeAndRollup(activeLeafSums, accountsByCode);

    // 10) Preorder starting at requested digit level (with forward fallback)
    const orderedNodes = this.preorderFromDigitLevel(nodes, roots, Math.max(1, Number(level || 1)));

    // 11) Emit rows
    const rows = orderedNodes.map((n) => ({
      accountCode: n.code,
      accountName: n.name,
      openingBalance: n.sum.openingBalance,
      periodDebit: n.sum.periodDebit,
      periodCredit: n.sum.periodCredit,
      closingBalance: n.sum.closingBalance,
      isGroup: n.children.size > 0, // group if has descendants included
      depth: n.depth,               // for optional indentation in UI
    }));

    // 12) Totals from leaves only (no double-count)
    const totals = Array.from(nodes.values())
      .filter((n) => n.leafHasActivity) // only direct-activity accounts
      .reduce(
        (t, n) => {
          t.openingBalance += n.sum.openingBalance;
          t.periodDebit += n.sum.periodDebit;
          t.periodCredit += n.sum.periodCredit;
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





/* ===== STANDARD ENDPOINT (JV-only rows, flat, prefix-friendly order, with parent info) ===== */
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
    level, // kept for signature; not used for ordering in JV-only mode
  } = params;

  // 1) Accounts & selection (need parentNumber + name to show parent columns)
  const accounts = await this.accountRepo.find({
    select: ['id', 'accountNumber', 'accountName', 'parentNumber'],
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
      currency,
      invoiceType,
      rows: [],
      totals: {
        openingDebit: 0, openingCredit: 0, openingBalance: 0,
        periodDebit: 0, periodCredit: 0, balance: 0,
        closingBalance: 0,
      },
    };
  }

  // 2) Invoice type filter helper
  const applyTypeFilter = (qb: ReturnType<typeof this.jvdRepo.createQueryBuilder>) => {
    if (invoiceType === 'S') {
      qb.andWhere('(jv.jvType = :tS OR d.docNbr LIKE :sPrefix)', { tS: 'S', sPrefix: 'S%' });
    } else if (invoiceType === 'G') {
      qb.andWhere('(jv.jvType = :tG OR d.docNbr LIKE :gPrefix)', { tG: 'G', gPrefix: 'G%' });
    }
    return qb;
  };

  // 3) Opening rows (before from) & Period rows ([from..to])
  let openingRows: JournalVoucherDetail[] = [];
  if (from) {
    const openQb = this.jvdRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.journalVoucher', 'jv')
      .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) })
      .andWhere('jv.date < :from', { from });
    applyTypeFilter(openQb);
    openingRows = await openQb.getMany();
  }

  const periodQb = this.jvdRepo
    .createQueryBuilder('d')
    .leftJoinAndSelect('d.journalVoucher', 'jv')
    .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) });
  if (from) periodQb.andWhere('jv.date >= :from', { from });
  if (to)   periodQb.andWhere('jv.date <= :to', { to });
  applyTypeFilter(periodQb);
  const periodRows = await periodQb.getMany();

  // 4) Sum by account using BASE columns (USD→drUSD/crUSD, LL→drLL/crLL, EURO|BASE→dr/cr)
  const { drCol, crCol } = this.getBaseCols(currency);

  type Tot = { debit: number; credit: number };
  const sumByAcc = (rowsIn: JournalVoucherDetail[]) => {
    const m = new Map<number, Tot>();
    for (const r of rowsIn) {
      const accId = r.accountId;
      if (!accId) continue;
      const debit  = Number((r as any)[drCol] || 0);
      const credit = Number((r as any)[crCol] || 0);
      const prev = m.get(accId) ?? { debit: 0, credit: 0 };
      prev.debit  += debit;
      prev.credit += credit;
      m.set(accId, prev);
    }
    return m;
  };

  const openMap   = sumByAcc(openingRows);
  const periodMap = sumByAcc(periodRows);

  // 5) JV-only: include ONLY accounts that appear in JV (opening or period)
  const activeIds = new Set<number>([
    ...Array.from(openMap.keys()),
    ...Array.from(periodMap.keys()),
  ]);

  if (!activeIds.size) {
    return {
      from: from ?? null,
      to: to ?? null,
      currency,
      invoiceType,
      rows: [],
      totals: {
        openingDebit: 0, openingCredit: 0, openingBalance: 0,
        periodDebit: 0, periodCredit: 0, balance: 0,
        closingBalance: 0,
      },
    };
  }

  // 6) Compose flat JV-only rows (include parentCode/parentName for each, but DO NOT add parent rows)
  const rows = selected
    .filter(acc => activeIds.has(acc.id))
    .map(acc => {
      const op = openMap.get(acc.id)   ?? { debit: 0, credit: 0 };
      const pr = periodMap.get(acc.id) ?? { debit: 0, credit: 0 };

      const openingBalance = op.debit - op.credit;
      const balance        = pr.debit - pr.credit; // period net
      const closingBalance = openingBalance + balance;

      const parentAcc = acc.parentNumber ? byCode.get(acc.parentNumber) : undefined;

      return {
        accountCode: String(acc.accountNumber),
        accountName: String(acc.accountName ?? ''),
        parentCode:  parentAcc ? String(parentAcc.accountNumber) : null,
        parentName:  parentAcc ? String(parentAcc.accountName ?? '') : null,

        // Opening
        openingDebit:   op.debit,
        openingCredit:  op.credit,
        openingBalance,

        // Period
        periodDebit:    pr.debit,
        periodCredit:   pr.credit,
        balance,

        // Closing
        closingBalance,
      };
    })
    // ✅ prefix-friendly order: digits-only, lexicographic
    .sort((a, b) => this.cmpLexDigits(a.accountCode, b.accountCode));

  // 7) Totals = sum of displayed rows (per-account figures only)
  const totals = rows.reduce(
    (t, r) => {
      t.openingDebit   += r.openingDebit;
      t.openingCredit  += r.openingCredit;
      t.openingBalance += r.openingBalance;
      t.periodDebit    += r.periodDebit;
      t.periodCredit   += r.periodCredit;
      t.balance        += r.balance;
      t.closingBalance += r.closingBalance;
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

  // 1) Accounts & selection
  const accounts = await this.accountRepo.find({
    select: ['id', 'accountNumber', 'accountName', 'parentNumber'],
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

  // 2) Invoice type filter helper
  const applyTypeFilter = (qb: ReturnType<typeof this.jvdRepo.createQueryBuilder>) => {
    if (invoiceType === 'S') {
      qb.andWhere('(jv.jvType = :tS OR d.docNbr LIKE :sPrefix)', { tS: 'S', sPrefix: 'S%' });
    } else if (invoiceType === 'G') {
      qb.andWhere('(jv.jvType = :tG OR d.docNbr LIKE :gPrefix)', { tG: 'G', gPrefix: 'G%' });
    }
    return qb;
  };

  // 3) Opening and Period rows
  let openingRows: JournalVoucherDetail[] = [];
  if (from) {
    const openQb = this.jvdRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.journalVoucher', 'jv')
      .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) })
      .andWhere('jv.date < :from', { from });
    applyTypeFilter(openQb);
    openingRows = await openQb.getMany();
  }

  const periodQb = this.jvdRepo
    .createQueryBuilder('d')
    .leftJoinAndSelect('d.journalVoucher', 'jv')
    .where('d.accountId IN (:...ids)', { ids: Array.from(selectedIds) });
  if (from) periodQb.andWhere('jv.date >= :from', { from });
  if (to)   periodQb.andWhere('jv.date <= :to', { to });
  applyTypeFilter(periodQb);
  const periodRows = await periodQb.getMany();

  // 4) ✅ Pin "main" math to USD, and also compute LL in parallel
  // CHANGE: remove getBaseCols(...) usage; always use USD here.
  const usdDrCol = 'drUSD';
  const usdCrCol = 'crUSD';
  const llDrCol  = 'drLL';
  const llCrCol  = 'crLL';

  type TotDual = { debitUSD: number; creditUSD: number; debitLL: number; creditLL: number };
  const sumByAccDual = (rowsIn: JournalVoucherDetail[]) => {
    const m = new Map<number, TotDual>();
    for (const r of rowsIn) {
      const accId = r.accountId;
      if (!accId) continue;

      const debitUSD  = Number((r as any)[usdDrCol] || 0);
      const creditUSD = Number((r as any)[usdCrCol] || 0);
      const debitLL   = Number((r as any)[llDrCol]  || 0);
      const creditLL  = Number((r as any)[llCrCol]  || 0);

      const prev = m.get(accId) ?? { debitUSD: 0, creditUSD: 0, debitLL: 0, creditLL: 0 };
      prev.debitUSD  += debitUSD;
      prev.creditUSD += creditUSD;
      prev.debitLL   += debitLL;
      prev.creditLL  += creditLL;
      m.set(accId, prev);
    }
    return m;
  };

  const openMap   = sumByAccDual(openingRows);
  const periodMap = sumByAccDual(periodRows);

  // 5) JV-only accounts
  const activeIds = new Set<number>([
    ...Array.from(openMap.keys()),
    ...Array.from(periodMap.keys()),
  ]);

  if (!activeIds.size) {
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

  // 6) Build rows (USD main + LL extras), prefix-friendly sort
  const rows = selected
    .filter(acc => activeIds.has(acc.id))
    .map(acc => {
      const op = openMap.get(acc.id)   ?? { debitUSD: 0, creditUSD: 0, debitLL: 0, creditLL: 0 };
      const pr = periodMap.get(acc.id) ?? { debitUSD: 0, creditUSD: 0, debitLL: 0, creditLL: 0 };

      // USD main
      const openingBalance = op.debitUSD - op.creditUSD;
      const balance        = pr.debitUSD - pr.creditUSD;      // period net USD
      const closingBalance = openingBalance + balance;

      // LL extras
      const openingBalanceLL = op.debitLL - op.creditLL;
      const balanceLL        = pr.debitLL - pr.creditLL;      // period net LL
      const closingBalanceLL = openingBalanceLL + balanceLL;

      const parentAcc = acc.parentNumber ? byCode.get(acc.parentNumber) : undefined;

      return {
        accountCode: String(acc.accountNumber),
        accountName: String(acc.accountName ?? ''),
        parentCode:  parentAcc ? String(parentAcc.accountNumber) : null,
        parentName:  parentAcc ? String(parentAcc.accountName ?? '') : null,

        // USD (main columns in your UI)
        openingDebit:  op.debitUSD,
        openingCredit: op.creditUSD,
        openingBalance,
        periodDebit:   pr.debitUSD,
        periodCredit:  pr.creditUSD,
        balance,
        closingBalance,

        // LL (extra columns requested)
        openingBalanceLL,
        periodDebitLL:  pr.debitLL,
        periodCreditLL: pr.creditLL,
        balanceLL,
        closingBalanceLL,
      };
    })
    .sort((a, b) => this.cmpLexDigits(a.accountCode, b.accountCode)); // same order as Standard

  // 7) Totals (USD + LL)
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