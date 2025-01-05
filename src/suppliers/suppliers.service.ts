import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(Supplier)
    private supplierRepository: Repository<Supplier>,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @InjectRepository(Currency)
    private currencyRepository: Repository<Currency>,
  ) {}

  async createSupplier(
    supplierData: Partial<Supplier> & { currencyId: number },
  ): Promise<Supplier> {
    const { supplierName, currencyId, ...otherFields } = supplierData;

    // Validate currency
    const currency = await this.currencyRepository.findOne({
      where: { id: currencyId },
    });
    if (!currency) {
      throw new NotFoundException(`Currency with ID ${currencyId} not found.`);
    }

    // Generate supplier account number
    const accountPrefix = '4011';
    const lastSupplier = await this.supplierRepository.find({
      where: { supplierAccountNumber: Like(`${accountPrefix}%`) },
      order: { supplierAccountNumber: 'DESC' },
      take: 1,
    });

    const newSupplierNumber =
      lastSupplier.length > 0
        ? parseInt(
            lastSupplier[0].supplierAccountNumber.replace(accountPrefix, ''),
          ) + 1
        : 1;

    const supplierAccountNumber = `${accountPrefix}${newSupplierNumber
      .toString()
      .padStart(4, '0')}`;

    // Link to the 4011 account
    const account = await this.accountRepository.findOne({
      where: { accountNumber: accountPrefix },
    });
    if (!account) {
      throw new NotFoundException(
        `Account with number ${accountPrefix} not found.`,
      );
    }

    // Create supplier
    const supplier = this.supplierRepository.create({
      supplierAccountNumber,
      supplierName,
      currency,
      account,
      ...otherFields,
    });

    return this.supplierRepository.save(supplier);
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

  async getSuppliersPaginated(
    page: number,
    limit: number,
  ): Promise<{ suppliers: Partial<Supplier>[]; total: number }> {
    const [suppliers, total] = await this.supplierRepository.findAndCount({
      select: [
        'id',
        'supplierAccountNumber',
        'supplierName',
        'address',
        'location',
        'phoneNumber',
        'invoiceType',
        'vat',
        'financialNumber',
      ],
      relations: ['currency', 'account'],
      skip: (page - 1) * limit,
      take: limit,
    });

    const filteredSuppliers = suppliers.map((supplier) => ({
      id: supplier.id,
      supplierAccountNumber: supplier.supplierAccountNumber,
      supplierName: supplier.supplierName,
      address: supplier.address,
      location: supplier.location,
      phoneNumber: supplier.phoneNumber,
      invoiceType: supplier.invoiceType,
      vat: supplier.vat,
      currencyCode: supplier.currency.currencyCode,
      financialNumber: supplier.financialNumber,
    }));

    return { suppliers: filteredSuppliers, total };
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
}
