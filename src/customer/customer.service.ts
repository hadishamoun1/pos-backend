import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';

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





  private getCurrencyCodeFromCustomer(c: any): 'USD' | 'LL' | 'EURO' | 'BASE' {
    // If you truly store c.currency.code somewhere, you can use it.
    // Keeping same fallback logic as your statement method:
    if (c?.currency?.code) return c.currency.code;
    if (Number(c.currencyId) === 2) return 'LL';
    return 'USD';
  }

 async getCustomerBasicDetails(): Promise<
  Array<{
    id: number;
    customerName: string | null;
    customerAccountNumber: string | null;
    firstName: string | null;
    middleName: string | null;
    phoneNumber: string | null;
    area: string | null;
    address: string | null;
    invoiceType: string | null;
    currencyId: number | null;
    currencyCode: 'USD' | 'LL' | 'EURO' | 'BASE';
    closingBalanceS: number; // S + RVR
    closingBalanceG: number; // G only
    balanceAsOf: string;
  }>
> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // 1) Load customers + currency code (so we pick correct columns)
  const customers = await this.customerRepository
    .createQueryBuilder('c')
    .leftJoin('c.currency', 'cur') // assumes relation exists
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
      'c.currencyId AS currencyId',
      'cur.code AS currencyCode',
    ])
    .getRawMany();

  if (!customers.length) return [];

  const normalizeCurrency = (rawCode: any, currencyId: any): 'USD' | 'LL' | 'EURO' | 'BASE' => {
    const c = String(rawCode ?? '').toUpperCase().trim();

    if (c === 'EUR' || c === 'EU' || c === 'EURO') return 'EURO';
    if (c === 'LBP' || c === 'L.L' || c === 'LL' || c === 'LIRA') return 'LL';
    if (c === 'BASE') return 'BASE';
    if (c === 'USD' || c === '$') return 'USD';

    // fallback (same idea you had)
    return Number(currencyId) === 2 ? 'LL' : 'USD';
  };

  // 2) Column maps
  const ofrColMap = {
    USD:  { dr: 'drUSDOFR', cr: 'crUSDOFR' },
    LL:   { dr: 'drLLOFR',  cr: 'crLLOFR'  },
    EURO: { dr: 'drOFR',    cr: 'crOFR'    },
    BASE: { dr: 'drOFR',    cr: 'crOFR'    },
  } as const;

  const baseColMap = {
    USD:  { dr: 'drUSD', cr: 'crUSD' },
    LL:   { dr: 'drLL',  cr: 'crLL'  },
    EURO: { dr: 'dr',    cr: 'cr'    },
    BASE: { dr: 'dr',    cr: 'cr'    },
  } as const;

  // 3) Group customer IDs by currency
  const idsByCurrency = new Map<'USD' | 'LL' | 'EURO' | 'BASE', number[]>();
  for (const c of customers as any[]) {
    const code = normalizeCurrency(c.currencyCode, c.currencyId);
    c.currencyCode = code;
    const id = Number(c.id);
    if (!idsByCurrency.has(code)) idsByCurrency.set(code, []);
    idsByCurrency.get(code)!.push(id);
  }

  // 4) Aggregated balances map
  const balanceMap = new Map<number, { s: number; g: number }>();

  for (const [code, ids] of idsByCurrency.entries()) {
    const sCols = baseColMap[code];
    const gCols = ofrColMap[code];

    const raws = await this.journalVoucherDetailRepository
      .createQueryBuilder('d')
      .leftJoin('d.journalVoucher', 'jv')
      .select('d.customerId', 'customerId')
      // ✅ S closing = S + RVR (using base columns)
      .addSelect(
        `
        SUM(
          CASE WHEN jv.jvType IN ('S','RVR')
            THEN (COALESCE(d.${sCols.dr},0) - COALESCE(d.${sCols.cr},0))
            ELSE 0
          END
        )
        `,
        'closingS',
      )
      // ✅ G closing = ONLY G (using OFR columns)
      .addSelect(
        `
        SUM(
          CASE WHEN jv.jvType = 'G'
            THEN (COALESCE(d.${gCols.dr},0) - COALESCE(d.${gCols.cr},0))
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

    for (const r of raws) {
      const cid = Number(r.customerId);
      balanceMap.set(cid, {
        s: Number(r.closingS || 0),
        g: Number(r.closingG || 0),
      });
    }
  }

  // 5) Return customers + balances
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
      invoiceType: c.invoiceType ?? null,
      currencyId: c.currencyId != null ? Number(c.currencyId) : null,
      currencyCode: c.currencyCode as 'USD' | 'LL' | 'EURO' | 'BASE',
      closingBalanceS: b.s, // S + RVR
      closingBalanceG: b.g, // G only
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

}
