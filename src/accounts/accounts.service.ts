import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { Customer } from 'src/entities/customer.entity';
import { Supplier } from 'src/entities/supplier.entity';
import { AccountingResolverService } from '../accountRoleMap/accounting-resolver.service';

type SearchKind = 'account' | 'customer' | 'supplier';

interface UnifiedRow {
  id: number;
  accountNumber: string;
  accountName: string;
  kind: SearchKind;
  parentAccountNumber?: string; // resolved (Customer_Index / Supplier_Index)
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,

    private readonly accountingResolver: AccountingResolverService,
  ) {}

  /** Resolve parent account numbers from indexes (no hardcoding) */
  private async getIndexParents(): Promise<{
    customerParent: string;
    supplierParent: string;
  }> {
    const custParentAcc = await this.accountingResolver.resolveAccount(
      'Customer_Index',
      null,
    );
    const suppParentAcc = await this.accountingResolver.resolveAccount(
      'Supplier_Index',
      null,
    );

    const customerParent = String(custParentAcc?.accountNumber ?? '').trim();
    const supplierParent = String(suppParentAcc?.accountNumber ?? '').trim();

    if (!customerParent) throw new Error('Customer_Index resolved to empty accountNumber');
    if (!supplierParent) throw new Error('Supplier_Index resolved to empty accountNumber');

    return { customerParent, supplierParent };
  }

  async createAccount(accountData: Partial<Account>): Promise<Account> {
    const account = this.accountRepository.create(accountData);
    return this.accountRepository.save(account);
  }

  async getAccountById(id: number): Promise<Account> {
    return this.accountRepository.findOne({
      where: { id },
      relations: ['parent', 'children'],
    });
  }

  async getAllAccounts(): Promise<Account[]> {
    return this.accountRepository.find({
      relations: ['parent', 'children'],
    });
  }

  async updateAccount(id: number, accountData: Partial<Account>): Promise<Account> {
    await this.accountRepository.update(id, accountData);
    return this.getAccountById(id);
  }

  async deleteAccount(id: number): Promise<void> {
    await this.accountRepository.delete(id);
  }

  // src/accounts/accounts.service.ts
  async getCombinedAccounts(): Promise<any[]> {
    const { customerParent, supplierParent } = await this.getIndexParents();

    // Fetch plain accounts (no relations — because we removed parent/children)
    const accounts = await this.accountRepository.find();

    // Fetch customer accounts
    const customers = await this.customerRepository.find({
      select: ['id', 'customerAccountNumber', 'customerName'],
    });

    // Fetch supplier accounts
    const suppliers = await this.supplierRepository.find({
      select: ['id', 'supplierAccountNumber', 'supplierName'],
    });

    // Build flat list, then React will build the hierarchy using parentNumber
    const combinedData = accounts.map((account) => {
      const node: any = {
        id: account.id,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        arabicAccountName: account.arabicAccountName,
        parentNumber: account.parentNumber,
        accessible: account.accessible,
        children: [] as any[],
      };

      // Attach customers under Customer_Index parent
      if (account.accountNumber === customerParent) {
        node.children.push(
          ...customers.map((customer) => ({
            id: customer.id,
            accountNumber: customer.customerAccountNumber,
            accountName: customer.customerName,
            parentNumber: customerParent,
            isCustomer: true,
            children: [],
          })),
        );
      }

      // Attach suppliers under Supplier_Index parent
      if (account.accountNumber === supplierParent) {
        node.children.push(
          ...suppliers.map((supplier) => ({
            id: supplier.id,
            accountNumber: supplier.supplierAccountNumber,
            accountName: supplier.supplierName,
            parentNumber: supplierParent,
            isSupplier: true,
            children: [],
          })),
        );
      }

      return node;
    });

    return combinedData;
  }

  async getAccounts(): Promise<any[]> {
    const { customerParent, supplierParent } = await this.getIndexParents();

    // Fetch accounts with parent-child relationships
    const accounts = await this.accountRepository.find({
      relations: ['parent', 'children'],
    });

    // Fetch customer accounts
    const customers = await this.customerRepository.find({
      select: ['id', 'customerAccountNumber', 'customerName'],
    });

    // Fetch supplier accounts
    const suppliers = await this.supplierRepository.find({
      select: ['id', 'supplierAccountNumber', 'supplierName'],
    });

    const transformAccounts = (accounts: any[], parentNumber: string | null = null): any[] => {
      return accounts
        .filter((account) => account.parent?.accountNumber === parentNumber)
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .map((account) => {
          const transformedAccount: any = {
            id: account.id,
            accountNumber: account.accountNumber,
            accountName: account.accountName,
            arabicAccountName: account.arabicAccountName || null,
            children: [],
          };

          // Add customers under Customer_Index parent
          if (account.accountNumber === customerParent) {
            transformedAccount.children.push(
              ...customers.map((customer) => ({
                id: customer.id,
                accountNumber: customer.customerAccountNumber,
                accountName: customer.customerName,
                arabicAccountName: null,
                isCustomer: true,
              })),
            );
          }

          // Add suppliers under Supplier_Index parent
          if (account.accountNumber === supplierParent) {
            transformedAccount.children.push(
              ...suppliers.map((supplier) => ({
                id: supplier.id,
                accountNumber: supplier.supplierAccountNumber,
                accountName: supplier.supplierName,
                arabicAccountName: null,
                isSupplier: true,
              })),
            );
          }

          transformedAccount.children.push(...transformAccounts(accounts, account.accountNumber));

          transformedAccount.children.sort((a, b) =>
            a.accountNumber.localeCompare(b.accountNumber),
          );

          return transformedAccount;
        });
    };

    return transformAccounts(accounts);
  }

  // ✅ Add this method to your AccountsService
  async getFlatSimplifiedAccounts(): Promise<any[]> {
    const { customerParent, supplierParent } = await this.getIndexParents();

    const accounts = await this.accountRepository.find();

    const customers = await this.customerRepository.find({
      select: ['id', 'customerAccountNumber', 'customerName'],
    });

    const suppliers = await this.supplierRepository.find({
      select: ['id', 'supplierAccountNumber', 'supplierName'],
    });

    const normalizeParent = (v?: string | null): string | null => {
      if (!v) return null;
      const trimmed = v.toString().trim();
      return trimmed === '' ? null : trimmed;
    };

    const buildHierarchy = (parentNumber: string | null = null): any[] => {
      return accounts
        .filter((acc) => normalizeParent(acc.parentNumber) === parentNumber)
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .map((acc) => {
          const node: any = {
            id: acc.id,
            accountNumber: acc.accountNumber,
            accountName: acc.arabicAccountName,
            parentNumber: acc.parentNumber || null,
            kind: 'account',
            refId: acc.id,
            children: [],
          };

          if (acc.accountNumber === customerParent) {
            node.children.push(
              ...customers.map((cust) => ({
                id: cust.id,
                accountNumber: cust.customerAccountNumber,
                accountName: cust.customerName,
                parentNumber: customerParent,
                kind: 'customer',
                refId: cust.id,
                children: [],
              })),
            );
          }

          if (acc.accountNumber === supplierParent) {
            node.children.push(
              ...suppliers.map((supp) => ({
                id: supp.id,
                accountNumber: supp.supplierAccountNumber,
                accountName: supp.supplierName,
                parentNumber: supplierParent,
                kind: 'supplier',
                refId: supp.id,
                children: [],
              })),
            );
          }

          node.children.push(...buildHierarchy(acc.accountNumber));
          return node;
        });
    };

    return buildHierarchy(null);
  }

  private normalizeDigits(s: string): string {
    if (!s) return '';
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    };
    return s.replace(/[٠-٩]/g, (d) => map[d] ?? d);
  }

  private rank(q: string, text: string): number {
    const a = (text || '').toLowerCase();
    const b = (q || '').toLowerCase();
    if (!b) return 0;
    if (a === b) return 3;
    if (a.startsWith(b)) return 2;
    if (a.includes(b)) return 1;
    return 0;
  }

  async searchCombinedAccounts(q: string, type?: SearchKind, page: number = 1, limit: number = 50) {
    const { customerParent, supplierParent } = await this.getIndexParents();

    const query = this.normalizeDigits((q || '').trim());
    if (!query) return { page, limit, total: 0, data: [] };

    const pattern = `%${query}%`;

    // 1) ACCOUNTS (exclude Customer_Index subtree and Supplier_Index subtree here)
    const accounts = await this.accountRepository
      .createQueryBuilder('a')
      .where('(a.accountNumber LIKE :pattern OR a.accountName LIKE :pattern)', { pattern })
      .andWhere('a.accountNumber NOT LIKE :cPrefix', { cPrefix: `${customerParent}%` })
      .andWhere('a.accountNumber NOT LIKE :sPrefix', { sPrefix: `${supplierParent}%` })
      .take(500)
      .getMany();

    // 2) CUSTOMERS
    const customers = await this.customerRepository.find({
      select: ['id', 'customerAccountNumber', 'customerName'],
      where: [
        { customerAccountNumber: Like(pattern) },
        { customerName: Like(pattern) },
      ],
      take: 500,
    });

    // 3) SUPPLIERS
    const suppliers = await this.supplierRepository.find({
      select: ['id', 'supplierAccountNumber', 'supplierName'],
      where: [
        { supplierAccountNumber: Like(pattern) },
        { supplierName: Like(pattern) },
      ],
      take: 500,
    });

    // 4) UNIFY
    const unifiedRaw: UnifiedRow[] = [
      ...accounts.map((a) => ({
        id: a.id,
        accountNumber: a.accountNumber,
        accountName: a.accountName || '',
        kind: 'account' as const,
      })),
      ...customers.map((c) => ({
        id: c.id,
        accountNumber: c.customerAccountNumber,
        accountName: c.customerName,
        kind: 'customer' as const,
        parentAccountNumber: customerParent,
      })),
      ...suppliers.map((s) => ({
        id: s.id,
        accountNumber: s.supplierAccountNumber,
        accountName: s.supplierName,
        kind: 'supplier' as const,
        parentAccountNumber: supplierParent,
      })),
    ];

    const bestByNumber = new Map<string, UnifiedRow>();
    const pref = (k: SearchKind) => (k === 'customer' ? 3 : k === 'supplier' ? 2 : 1);
    for (const r of unifiedRaw) {
      const key = (r.accountNumber || '').trim();
      const cur = bestByNumber.get(key);
      if (!cur || pref(r.kind) > pref(cur.kind)) bestByNumber.set(key, r);
    }
    const unified = Array.from(bestByNumber.values());

    const filtered = type ? unified.filter((u) => u.kind === type) : unified;

    const scored = filtered.map((row) => {
      const sNum = this.rank(query, row.accountNumber);
      const sName = this.rank(query, row.accountName);
      const kindBoost = 0;
      return { row, score: sNum * 10 + sName * 5 + kindBoost };
    });
    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const start = (page - 1) * limit;
    const data = scored.slice(start, start + limit).map((x) => x.row);

    return { page, limit, total, data };
  }
}
