import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @InjectRepository(Currency)
    private currencyRepository: Repository<Currency>,
  ) {}

  // --- area → code mapping (case-insensitive); `as const` keeps literal key types ---
  private static readonly AREA_CODES = {
    beirut: '01',
    south:  '02',
    bekaa:  '03',
    north:  '04',
    export: '05',
    others: '06',
  } as const;

  private normalizeArea(
    area?: string,
  ): keyof typeof CustomerService.AREA_CODES {
    const k = (area ?? '').trim().toLowerCase();
    if (k in CustomerService.AREA_CODES) {
      return k as keyof typeof CustomerService.AREA_CODES;
    }
    return 'others';
  }

  private normalizeInvoiceType(x?: string): 'S' | 'G' | 'Both' | undefined {
    if (!x) return undefined;
    const v = String(x).trim().toLowerCase();
    if (v === 's' || v === 'sale' || v === 'sales') return 'S';
    if (v === 'g' || v === 'general') return 'G';
    if (v === 'both') return 'Both';
    return undefined;
  }

  /**
   * Generate next account number for a given area:
   * 4111 + areaCode(2) + sequence(3)
   * Example (Beirut): 4111 01 001  ->  "411101001"
   */
  private async generateCustomerAccountNumber(area?: string): Promise<string> {
    const base = '4111';
    const areaKey  = this.normalizeArea(area);
    const areaCode = CustomerService.AREA_CODES[areaKey];
    const prefix   = `${base}${areaCode}`; // e.g. 411101

    const lastForArea = await this.customerRepository.find({
      where: { customerAccountNumber: Like(`${prefix}%`) },
      select: ['customerAccountNumber'],
      order: { customerAccountNumber: 'DESC' },
      take: 1,
    });

    let nextSeq = 1;
    if (lastForArea.length) {
      const last = lastForArea[0].customerAccountNumber ?? '';
      const tail = last.slice(-3);         // last 3 digits
      const parsed = parseInt(tail, 10);
      if (Number.isFinite(parsed)) nextSeq = parsed + 1;
    }

    const seqStr = nextSeq.toString().padStart(3, '0');
    return `${prefix}${seqStr}`; // e.g. 411101001
  }

  /**
   * Create customer with full support for new columns and area-based numbering.
   * If `customerAccountNumber` is provided explicitly in payload, we keep it; otherwise we generate one.
   */
  async createCustomer(customerData: Partial<Customer>): Promise<Customer> {
    const {
      customerName,
      currencyId,
      firstName,
      middleName,
      paymentTerms,
      area,
      companyType,
      address,
      phoneNumber,
      financialNumber,
      invoiceType,
      vat,
      customerAccountNumber: providedNumber,
      ...rest
    } = customerData;

    if (!customerName) {
      throw new NotFoundException('customerName is required.');
    }
    if (!currencyId) {
      throw new NotFoundException('currencyId is required.');
    }

    // Validate currency
    const currency = await this.currencyRepository.findOne({ where: { id: currencyId } });
    if (!currency) {
      throw new NotFoundException(`Currency with ID ${currencyId} not found.`);
    }

    // Link to the 4111 parent account
    const parentAccountNumber = '4111';
    const account = await this.accountRepository.findOne({ where: { accountNumber: parentAccountNumber } });
    if (!account) {
      throw new NotFoundException(`Account with number ${parentAccountNumber} not found.`);
    }

    // Account number: use provided or generate based on area bucket
    const customerAccountNumber =
      providedNumber && String(providedNumber).trim().length > 0
        ? String(providedNumber).trim()
        : await this.generateCustomerAccountNumber(area);

    // Normalize invoice type if needed
    const normalizedInvoiceType =
      this.normalizeInvoiceType(invoiceType as any) ?? (invoiceType as any);

    // Normalize area string for storage (keeps "beirut" | "south" | ...). If you prefer raw input, store `area` instead.
    const areaNormalized = this.normalizeArea(area);

    const customer = this.customerRepository.create({
      customerAccountNumber,
      customerName,

      // NEW FIELDS
      firstName,
      middleName,
      paymentTerms,
      area: areaNormalized,                // stored normalized key
      companyType,
      address,
      phoneNumber,
      financialNumber,
      invoiceType: normalizedInvoiceType,  // 'S' | 'G' | 'Both' | undefined
      vat,

      // relations
      currency,
      account,

      // any extras from caller (kept for compatibility)
      ...rest,
    });

    return this.customerRepository.save(customer);
  }

  async getAllCustomers(): Promise<Customer[]> {
    return this.customerRepository.find({ relations: ['currency', 'account'] });
  }

  async getCustomerById(id: number): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id },
      relations: ['currency', 'account'],
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found.`);
    }
    return customer;
  }

  async getCustomersPaginated(
    page: number,
    limit: number,
  ): Promise<{ customers: Partial<Customer>[]; total: number }> {
    const [customers, total] = await this.customerRepository.findAndCount({
      select: [
        'id',
        'customerAccountNumber',
        'customerName',
        'address',
        'phoneNumber',
        'invoiceType',
        'vat',
        'financialNumber',
      ],
      relations: ['currency', 'account'],
      skip: (page - 1) * limit,
      take: limit,
    });

    const filteredCustomers = customers.map((customer) => ({
      id: customer.id,
      customerAccountNumber: customer.customerAccountNumber,
      customerName: customer.customerName,
      address: customer.address,
      phoneNumber: customer.phoneNumber,
      invoiceType: customer.invoiceType,
      vat: customer.vat,
      currencyCode: customer.currency?.currencyCode,
      financialNumber: customer.financialNumber,
    }));

    return { customers: filteredCustomers, total };
  }

  async getCustomerBasicDetails(): Promise<Partial<Customer>[]> {
    const customers = await this.customerRepository.find({
      select: ['id', 'customerName', 'customerAccountNumber'],
    });
    return customers;
  }

  /**
   * ✅ Search customers by name and return only id & customerName
   */
/**
 * ✅ Search customers by name (or firstName) and return id, customerName, firstName, address
 */
async searchCustomers(
  query: string,
): Promise<Array<{ id: number; customerName: string; firstName: string | null; address: string | null }>> {
  if (!query?.trim()) return [];

  const q = `%${query.trim()}%`;

  const results = await this.customerRepository.find({
    // match on customerName OR firstName (remove the second object if you only want customerName)
    where: [{ customerName: Like(q) }, { firstName: Like(q) }],
 select: ['id', 'customerName', 'firstName', 'address', 'phoneNumber'],
    take: 10,
  });

  return results.map(r => ({
    id: r.id,
    customerName: r.customerName,
    firstName: r.firstName ?? null,
    address: r.address ?? null,
    phoneNumber : r.phoneNumber ?? null,
  }));
}

}
