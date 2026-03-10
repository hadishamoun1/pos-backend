import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';
import { AccountingResolverService } from 'src/accountRoleMap/accounting-resolver.service';

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(Supplier)
    private supplierRepository: Repository<Supplier>,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @InjectRepository(Currency)
    private currencyRepository: Repository<Currency>,
    private readonly accountingResolver: AccountingResolverService,

  ) {}

  /**
   * Create supplier.
   * - Validates currency
   * - Links to parent account 4011
   * - Generates supplierAccountNumber "4011####" unless you pass one
   * - Saves new fields: firstName, middleName, area, companyType, paymentTerms
   */
  async createSupplier(
    supplierData: Partial<Supplier> & { currencyId: number; supplierAccountNumber?: string },
  ): Promise<Supplier> {
    const {
      supplierName,
      currencyId,
      supplierAccountNumber: providedNumber,
      firstName,
      middleName,
      area,
      companyType,
      paymentTerms,
      address,
      phoneNumber,
      financialNumber,
      vat,
      ...rest
    } = supplierData;

    if (!supplierName) throw new NotFoundException('supplierName is required.');
    if (!currencyId) throw new NotFoundException('currencyId is required.');

    const currency = await this.currencyRepository.findOne({ where: { id: currencyId } });
    if (!currency) throw new NotFoundException(`Currency with ID ${currencyId} not found.`);

    // ✅ NEW: resolve parent account from role map
    const parentAccount = await this.accountingResolver.resolveAccount('Supplier_Index', null);
    const prefix = String((parentAccount as any).accountNumber ?? '').trim();
    if (!prefix) throw new NotFoundException('Supplier_Index returned empty accountNumber');

    // ✅ Use provided supplierAccountNumber or generate next PREFIX#### sequence
    const supplierAccountNumber =
      providedNumber && String(providedNumber).trim()
        ? String(providedNumber).trim()
        : await this.generateSupplierAccountNumber(prefix);

    const supplier = this.supplierRepository.create({
      supplierAccountNumber,
      supplierName,
      firstName,
      middleName,
      area,
      companyType,
      paymentTerms,
      address,
      phoneNumber,
      financialNumber,
      vat,
      currency,

      // ✅ Link supplier to the resolved parent account
      account: parentAccount as any,

      ...rest,
    });

    return this.supplierRepository.save(supplier);
  }

  /** ✅ Generate next "PREFIX####" based on the current max */
  private async generateSupplierAccountNumber(prefix: string): Promise<string> {
    const accountPrefix = String(prefix).trim();

    const last = await this.supplierRepository.find({
      where: { supplierAccountNumber: Like(`${accountPrefix}%`) },
      order: { supplierAccountNumber: 'DESC' },
      take: 1,
    });

    const nextNum =
      last.length > 0
        ? parseInt(String(last[0].supplierAccountNumber).replace(accountPrefix, ''), 10) + 1
        : 1;

    return `${accountPrefix}${nextNum.toString().padStart(3, '0')}`;
  }

  async getAllSuppliers(): Promise<Supplier[]> {
    return this.supplierRepository.find({ relations: ['currency', 'account'] });
  }

  async getSupplierById(id: number): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({
      where: { id },
      relations: ['currency', 'account'],
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${id} not found.`);
    }
    return supplier;
  }

  /**
   * Paginated list for tables
   * Note: only selecting fields that exist in the current entity.
   */
  async getSuppliersPaginated(
    page: number,
    limit: number,
  ): Promise<{ suppliers: Partial<Supplier>[]; total: number }> {
    const [suppliers, total] = await this.supplierRepository.findAndCount({
      select: [
        'id',
        'supplierAccountNumber',
        'supplierName',
        'firstName',
        'middleName',
        'area',
        'companyType',
        'paymentTerms',
        'address',
        'phoneNumber',
        'vat',
        'financialNumber',
      ],
      relations: ['currency', 'account'],
      skip: (page - 1) * limit,
      take: limit,
    });

    const rows = suppliers.map((s) => ({
      id: s.id,
      supplierAccountNumber: s.supplierAccountNumber,
      supplierName: s.supplierName,
      firstName: s.firstName,
      middleName: s.middleName,
      area: s.area,
      companyType: s.companyType,
      paymentTerms: s.paymentTerms,
      address: s.address,
      phoneNumber: s.phoneNumber,
      vat: s.vat,
      financialNumber: s.financialNumber,
      currencyCode: s.currency?.currencyCode,
    }));

    return { suppliers: rows, total };
  }

  async deleteSupplier(id: number): Promise<void> {
    const supplier = await this.getSupplierById(id);
    await this.supplierRepository.remove(supplier);
  }

  async getFilteredSuppliers(): Promise<Partial<Supplier>[]> {
    const suppliers = await this.supplierRepository.find({
      select: ['id', 'supplierName'],
    });
    return suppliers;
  }

  async searchSuppliers(query: string): Promise<{ id: number; supplierName: string }[]> {
    if (!query) return [];
    const results = await this.supplierRepository.find({
      where: { supplierName: Like(`%${query}%`) },
      select: ['id', 'supplierName'],
      take: 10,
    });
    return results.map(r => ({ id: r.id, supplierName: r.supplierName }));
  }
}
