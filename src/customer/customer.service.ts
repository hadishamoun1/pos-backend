import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';


export type CustomerBasicWithBalances = {
  id: number;
  customerName: string | null;
  customerAccountNumber: string | null;
  firstName: string | null;
  middleName: string | null;
  phoneNumber: string | null;
  area: string | null;
  address: string | null;
  invoiceType: Customer['invoiceType'] | null; // 'S' | 'G' | 'Both'
  closingBalanceS: number; // S + SR
  closingBalanceG: number; // G only
  balanceAsOf: string;     // YYYY-MM-DD
};

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @InjectRepository(Currency)
    private currencyRepository: Repository<Currency>,
    @InjectRepository(JournalVoucherDetail)
    private journalVoucherDetailRepository: Repository<JournalVoucherDetail>,

    
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

    // ✅ new fields in your entity
    firstName,
    middleName,
    lastName,
    paymentTerms,
    area,
    companyType,
    address,
    phoneNumber,
    financialNumber,
    invoiceType,
    vat,

    // existing optional/manual account number
    customerAccountNumber: providedNumber,

    // any extra fields passed by caller (kept for compatibility)
    ...rest
  } = customerData;

  if (!customerName) {
    throw new NotFoundException('customerName is required.');
  }
  if (!currencyId) {
    throw new NotFoundException('currencyId is required.');
  }

  // Validate currency
  const currency = await this.currencyRepository.findOne({
    where: { id: currencyId },
  });
  if (!currency) {
    throw new NotFoundException(`Currency with ID ${currencyId} not found.`);
  }

  // Link to the 4111 parent account
  const parentAccountNumber = '4111';
  const account = await this.accountRepository.findOne({
    where: { accountNumber: parentAccountNumber },
  });
  if (!account) {
    throw new NotFoundException(
      `Account with number ${parentAccountNumber} not found.`,
    );
  }

  // Account number: use provided or generate based on area bucket
  const customerAccountNumber =
    providedNumber && String(providedNumber).trim().length > 0
      ? String(providedNumber).trim()
      : await this.generateCustomerAccountNumber(area);

  // Normalize invoice type if needed
  const normalizedInvoiceType =
    this.normalizeInvoiceType(invoiceType as any) ?? (invoiceType as any);

  // Normalize area string for storage (you can store raw `area` if you prefer)
  const areaNormalized = this.normalizeArea(area);

  const customer = this.customerRepository.create({
    customerAccountNumber,
    customerName,

    // ✅ NEW FIELDS
    firstName,
    middleName,
    lastName,
    paymentTerms,
    area: areaNormalized,
    companyType,
    address,
    phoneNumber,
    financialNumber,
    invoiceType: normalizedInvoiceType, // 'S' | 'G' | 'Both' | undefined
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

      // ✅ NEW fields you added
      'firstName',
      'middleName',
      'lastName',
      'paymentTerms',
      'area',
      'companyType',

      // existing
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

    // ✅ NEW fields
    firstName: customer.firstName ?? null,
    middleName: customer.middleName ?? null,
    lastName: customer.lastName ?? null,
    paymentTerms: customer.paymentTerms ?? null,
    area: customer.area ?? null,
    companyType: customer.companyType ?? null,

    // existing
    address: customer.address,
    phoneNumber: customer.phoneNumber,
    invoiceType: customer.invoiceType,
    vat: customer.vat,
    currencyCode: customer.currency?.currencyCode,
    financialNumber: customer.financialNumber,
  }));

  return { customers: filteredCustomers, total };
}





  private getCurrencyCodeFromCustomer(c: any): 'USD' | 'LL' | 'EURO' | 'BASE' {
    // If you truly store c.currency.code somewhere, you can use it.
    // Keeping same fallback logic as your statement method:
    if (c?.currency?.code) return c.currency.code;
    if (Number(c.currencyId) === 2) return 'LL';
    return 'USD';
  }





  

async getCustomerBasicDetails(): Promise<CustomerBasicWithBalances[]> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // 1) Load customers (no currency join)
  const customers = await this.customerRepository
    .createQueryBuilder('c')
    .select([
      'c.id AS id',
      'c.customerName AS customerName',
      'c.customerAccountNumber AS customerAccountNumber',
      'c.firstName AS firstName',
      'c.middleName AS middleName',
      'c.phoneNumber AS phoneNumber',
      'c.area AS area',
      'c.address AS address',
      'c.invoiceType AS invoiceType',
    ])
    .getRawMany();

  if (!customers.length) return [];

  const ids = customers.map((c: any) => Number(c.id)).filter((n) => Number.isFinite(n));
  if (!ids.length) return [];

  // 2) Aggregate balances for ALL customers in one query (USD only)
  const raws = await this.journalVoucherDetailRepository
    .createQueryBuilder('d')
    .leftJoin('d.journalVoucher', 'jv')
    .select('d.customerId', 'customerId')
    // S + SR use drUSD/crUSD
    .addSelect(
      `
      SUM(
        CASE WHEN jv.jvType IN ('S','SR')
          THEN (COALESCE(d.drUSD,0) - COALESCE(d.crUSD,0))
          ELSE 0
        END
      )
      `,
      'closingS',
    )
    // G only uses drUSDOFR/crUSDOFR
    .addSelect(
      `
      SUM(
        CASE WHEN jv.jvType = 'G'
          THEN (COALESCE(d.drUSDOFR,0) - COALESCE(d.crUSDOFR,0))
          ELSE 0
        END
      )
      `,
      'closingG',
    )
    .where('d.customerId IN (:...ids)', { ids })
    .andWhere('jv.date <= :today', { today })
    .groupBy('d.customerId')
    .getRawMany();

  const balanceMap = new Map<number, { s: number; g: number }>();
  for (const r of raws as any[]) {
    balanceMap.set(Number(r.customerId), {
      s: Number(r.closingS || 0),
      g: Number(r.closingG || 0),
    });
  }

  // 3) Return customers + balances
  return (customers as any[]).map((c) => {
    const b = balanceMap.get(Number(c.id)) ?? { s: 0, g: 0 };

    return {
      id: Number(c.id),
      customerName: c.customerName ?? null,
      customerAccountNumber: c.customerAccountNumber ?? null,
      firstName: c.firstName ?? null,
      middleName: c.middleName ?? null,
      phoneNumber: c.phoneNumber ?? null,
      area: c.area ?? null,
      address: c.address ?? null,
      invoiceType: (c.invoiceType ?? null) as Customer['invoiceType'] | null,
      closingBalanceS: b.s,
      closingBalanceG: b.g,
      balanceAsOf: today,
    };
  });
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


// ✅ COMPLETE: CustomerService.updateCustomer (drop-in)
async updateCustomer(id: number, dto: Partial<Customer>): Promise<Customer> {
  // 1) Find existing
  const customer = await this.customerRepository.findOne({
    where: { id },
    relations: ['currency', 'account'],
  });
  if (!customer) {
    throw new NotFoundException(`Customer with ID ${id} not found.`);
  }

  // 2) Update currency if provided
  if (dto.currencyId != null) {
    const currency = await this.currencyRepository.findOne({
      where: { id: Number(dto.currencyId) },
    });
    if (!currency) {
      throw new NotFoundException(`Currency with ID ${dto.currencyId} not found.`);
    }
    customer.currency = currency;
    customer.currencyId = currency.id as any;
  }

  // 3) IMPORTANT: do NOT auto-regenerate account number on edit
  //    Only change it if explicitly provided
  if (dto.customerAccountNumber != null) {
    const v = String(dto.customerAccountNumber).trim();
    if (v) customer.customerAccountNumber = v;
  }

  // 4) Normalize invoiceType if provided
  if (dto.invoiceType != null) {
    const normalized =
      this.normalizeInvoiceType(dto.invoiceType as any) ?? (dto.invoiceType as any);
    customer.invoiceType = normalized as any;
  }

  // 5) Normalize area if provided
  if (dto.area != null) {
    customer.area = this.normalizeArea(dto.area) as any;
  }

  // 6) Update normal scalar fields (only if provided)
  if (dto.customerName != null) customer.customerName = dto.customerName as any;

  if (dto.firstName != null) customer.firstName = dto.firstName as any;
  if (dto.middleName != null) customer.middleName = dto.middleName as any;
  if (dto.lastName != null) customer.lastName = dto.lastName as any;

  if (dto.paymentTerms != null) customer.paymentTerms = dto.paymentTerms as any;
  if (dto.companyType != null) customer.companyType = dto.companyType as any;

  if (dto.address != null) customer.address = dto.address as any;
  if (dto.phoneNumber != null) customer.phoneNumber = dto.phoneNumber as any;

  if (dto.financialNumber != null) customer.financialNumber = dto.financialNumber as any;
  if (dto.vat != null) customer.vat = dto.vat as any;

  // account remains the same (linked to 4111 on create) unless you add explicit logic

  // 7) Save
  return this.customerRepository.save(customer);
}


}
