import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { Customer } from 'src/entities/customer.entity';
import { Supplier } from 'src/entities/supplier.entity';
type SearchKind = 'account' | 'customer' | 'supplier';

interface UnifiedRow {
  id: number;
  accountNumber: string;
  accountName: string;
  kind: SearchKind;
  parentAccountNumber?: string; // e.g. 4111 for customers, 4011 for suppliers
}

@Injectable()
export class AccountsService {

  
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>, // Inject CustomerRepository
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>, // Inject SupplierRepository
  ) {}

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

  async updateAccount(
    id: number,
    accountData: Partial<Account>,
  ): Promise<Account> {
    await this.accountRepository.update(id, accountData);
    return this.getAccountById(id);
  }

  async deleteAccount(id: number): Promise<void> {
    await this.accountRepository.delete(id);
  }
  async getCombinedAccounts(): Promise<any[]> {
    // Fetch accounts
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

    // Combine data
    const combinedData = accounts.map((account) => {
      const data: any = {
        ...account,
        children: account.children ? [...account.children] : [],
      };

      // Add customers under the parent account '4111'
      if (account.accountNumber === '4111') {
        data.children.push(
          ...customers.map((customer) => ({
            id: customer.id,
            accountNumber: customer.customerAccountNumber,
            accountName: customer.customerName,
            isCustomer: true, // Add a flag to distinguish customers
          })),
        );
      }

      // Add suppliers under the parent account '4011'
      if (account.accountNumber === '4011') {
        data.children.push(
          ...suppliers.map((supplier) => ({
            id: supplier.id,
            accountNumber: supplier.supplierAccountNumber,
            accountName: supplier.supplierName,
            isSupplier: true, // Add a flag to distinguish suppliers
          })),
        );
      }

      return data;
    });

    return combinedData;
  }
  async getAccounts(): Promise<any[]> {
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

    // Function to recursively transform and sort accounts
    const transformAccounts = (
      accounts: any[],
      parentNumber: string | null = null,
    ): any[] => {
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

          // Add customers under '4111'
          if (account.accountNumber === '4111') {
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

          // Add suppliers under '4011'
          if (account.accountNumber === '4011') {
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

          // Recursively transform children
          transformedAccount.children.push(
            ...transformAccounts(accounts, account.accountNumber),
          );

          // Sort children by accountNumber
          transformedAccount.children.sort((a, b) =>
            a.accountNumber.localeCompare(b.accountNumber),
          );

          return transformedAccount;
        });
    };

    // Start transformation from root accounts (those without a parent)
    return transformAccounts(accounts);
  }
  // ✅ Add this method to your AccountsService
  async getFlatSimplifiedAccounts(): Promise<any[]> {
    const accounts = await this.accountRepository.find({
      relations: ['parent', 'children'],
    });

    const customers = await this.customerRepository.find({
      select: ['id', 'customerAccountNumber', 'customerName'],
    });

    const suppliers = await this.supplierRepository.find({
      select: ['id', 'supplierAccountNumber', 'supplierName'],
    });

    // Recursive transformer
    const buildHierarchy = (parentNumber: string | null = null): any[] => {
      return accounts
        .filter((acc) => (acc.parent?.accountNumber || null) === parentNumber)
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .map((acc) => {
          const node: any = {
            id: acc.id,
            accountNumber: acc.accountNumber,
            accountName: acc.arabicAccountName,
            parentNumber: acc.parentNumber || null,
            children: [],
          };

          // Add customer accounts under 4111
          if (acc.accountNumber === '4111') {
            node.children.push(
              ...customers.map((cust) => ({
                id: cust.id,
                accountNumber: cust.customerAccountNumber,
                accountName: cust.customerName,
                parentNumber: '4111',
                children: [],
              })),
            );
          }

          // Add supplier accounts under 4011
          if (acc.accountNumber === '4011') {
            node.children.push(
              ...suppliers.map((supp) => ({
                id: supp.id,
                accountNumber: supp.supplierAccountNumber,
                accountName: supp.supplierName,
                parentNumber: '4011',
                children: [],
              })),
            );
          }

          // Recursively build children
          node.children.push(...buildHierarchy(acc.accountNumber));
          return node;
        });
    };

    // Start from top-level accounts (no parent)
    return buildHierarchy(null);
  }



    private normalizeDigits(s: string): string {
    if (!s) return '';
    const map: Record<string, string> = {
      '٠':'0','١':'1','٢':'2','٣':'3','٤':'4',
      '٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
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
    // tweak scoring if you want, e.g., weight number vs name differently
  }
  

 async searchCombinedAccounts(
    q: string,
    type?: SearchKind,
    page: number = 1,
    limit: number = 50,
  ) {
    const query = this.normalizeDigits((q || '').trim());
    if (!query) return { page, limit, total: 0, data: [] };

    const pattern = `%${query}%`;

    // 1) ACCOUNTS (exclude 4111* and 4011* here so those come ONLY from their tables)
    const accounts = await this.accountRepository
      .createQueryBuilder('a')
      .where('(a.accountNumber LIKE :pattern OR a.accountName LIKE :pattern)', { pattern })
      .andWhere('a.accountNumber NOT LIKE :cPrefix', { cPrefix: '4111%' })
      .andWhere('a.accountNumber NOT LIKE :sPrefix', { sPrefix: '4011%' })
      .take(500)
      .getMany();

    // 2) CUSTOMERS (4111 subtree)
    const customers = await this.customerRepository.find({
      select: ['id', 'customerAccountNumber', 'customerName'],
      where: [
        { customerAccountNumber: Like(pattern) },
        { customerName: Like(pattern) },
      ],
      take: 500,
    });

    // 3) SUPPLIERS (4011 subtree)
    const suppliers = await this.supplierRepository.find({
      select: ['id', 'supplierAccountNumber', 'supplierName'],
      where: [
        { supplierAccountNumber: Like(pattern) },
        { supplierName: Like(pattern) },
      ],
      take: 500,
    });

    // 4) UNIFY (note: 4111/4011 families come ONLY from their own tables now)
    const unifiedRaw: UnifiedRow[] = [
      ...accounts.map(a => ({
        id: a.id,
        accountNumber: a.accountNumber,
        accountName: a.accountName || '',
        kind: 'account' as const,
      })),
      ...customers.map(c => ({
        id: c.id, // real customer id
        accountNumber: c.customerAccountNumber,
        accountName: c.customerName,
        kind: 'customer' as const,
        parentAccountNumber: '4111',
      })),
      ...suppliers.map(s => ({
        id: s.id, // real supplier id
        accountNumber: s.supplierAccountNumber,
        accountName: s.supplierName,
        kind: 'supplier' as const,
        parentAccountNumber: '4011',
      })),
    ];

    // OPTIONAL: if any duplicate accountNumber appears from multiple sources,
    // prefer customer/supplier label over generic account.
    const bestByNumber = new Map<string, UnifiedRow>();
    const pref = (k: SearchKind) => (k === 'customer' ? 3 : k === 'supplier' ? 2 : 1);
    for (const r of unifiedRaw) {
      const key = (r.accountNumber || '').trim();
      const cur = bestByNumber.get(key);
      if (!cur || pref(r.kind) > pref(cur.kind)) bestByNumber.set(key, r);
    }
    const unified = Array.from(bestByNumber.values());

    // Optional filter by kind=account|customer|supplier
    const filtered = type ? unified.filter(u => u.kind === type) : unified;

    // 5) relevance & pagination
    const scored = filtered.map(row => {
      const sNum = this.rank(query, row.accountNumber);
      const sName = this.rank(query, row.accountName);
      // small boost for 'account' in tie if you want; or set to 0
      const kindBoost = 0;
      return { row, score: sNum * 10 + sName * 5 + kindBoost };
    });
    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const start = (page - 1) * limit;
    const data = scored.slice(start, start + limit).map(x => x.row);

    return { page, limit, total, data };
  }
}


