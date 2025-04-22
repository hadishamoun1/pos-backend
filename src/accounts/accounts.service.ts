import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { Customer } from 'src/entities/customer.entity';
import { Supplier } from 'src/entities/supplier.entity';

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
            accountName: acc.accountName,
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
}
