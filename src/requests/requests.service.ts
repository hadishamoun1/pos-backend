import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { Customer } from '../entities/customer.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Settings } from '../entities/settings.entity';
import { RequestGateway } from './requests.gateway';
@Injectable()
export class RequestService {
  constructor(
    @InjectRepository(Request) private requestRepo: Repository<Request>,
    @InjectRepository(RequestDetail)
    private detailRepo: Repository<RequestDetail>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(ItemVariant)
    private itemVariantRepo: Repository<ItemVariant>,
    @InjectRepository(Settings) private settingsRepo: Repository<Settings>,
    private requestGateway: RequestGateway,
  ) {}

  async createRequest(data: any): Promise<Request> {
    const {
      requestDate,
      totalAmount,
      vatAmount,
      grandTotal,
      customerId,
      details,
    } = data;

    // ✅ Validate Customer
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // ✅ Get Active Year from Settings
    const activeYear = await this.settingsRepo.findOne({
      where: { isActive: true },
    });
    if (!activeYear) {
      throw new NotFoundException('No active year found in Settings.');
    }
    const year = activeYear.year.slice(-2); // Extract last 2 digits (e.g., '2025' → '25')
    const prefix = `REQ${year}`;

    // ✅ Find the last request number **correctly**
    const lastRequest = await this.requestRepo
      .createQueryBuilder('request')
      .select(
        "CAST(SUBSTRING_INDEX(request.requestNumber, ' - ', -1) AS UNSIGNED) AS maxNumber",
      )
      .where('request.requestNumber LIKE :prefix', { prefix: `${prefix} - %` })
      .orderBy('maxNumber', 'DESC')
      .limit(1)
      .getRawOne();

    // ✅ Ensure correct numbering
    const newRequestNumber = lastRequest?.maxNumber
      ? parseInt(lastRequest.maxNumber) + 1
      : 1;
    const requestNumber = `${prefix} - ${newRequestNumber}`;

    // ✅ Validate and Link Item Variants
    const requestDetails = await Promise.all(
      details.map(async (detail) => {
        const { itemVariantId, quantity, sqm, price, total } = detail;

        const itemVariant = await this.itemVariantRepo.findOne({
          where: { id: itemVariantId },
          relations: ['thickness', 'thickness.item'],
        });

        if (!itemVariant) {
          throw new NotFoundException(
            `ItemVariant with ID ${itemVariantId} not found.`,
          );
        }

        return this.detailRepo.create({
          itemVariant,
          quantity,
          sqm,
          price,
          total,
        });
      }),
    );

    // ✅ Create and Save Request
    const request = this.requestRepo.create({
      requestNumber, // ✅ Set Auto-Generated Request Number
      requestDate,
      totalAmount,
      vatAmount,
      grandTotal,
      customer,
      details: requestDetails,
    });

    const savedRequest = await this.requestRepo.save(request);

    // ✅ Emit the new request to all connected clients
    this.requestGateway.notifyNewRequest({
      id: savedRequest.id,
      requestNumber: savedRequest.requestNumber,
      requestDate: savedRequest.requestDate,
      totalAmount: savedRequest.totalAmount,
      vatAmount: savedRequest.vatAmount,
      grandTotal: savedRequest.grandTotal,
      customerName: customer.customerName,
      invoiceType: customer.invoiceType,
    });

    return savedRequest;
  }

  async getAllRequests(): Promise<Request[]> {
    return this.requestRepo.find({
      relations: [
        'customer',
        'details',
        'details.itemVariant',
        'details.itemVariant.thickness',
        'details.itemVariant.thickness.item',
      ],
    });
  }

  async getRequestById(id: number): Promise<any> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: [
        'customer',
        'details',
        'details.itemVariant',
        'details.itemVariant.thickness',
        'details.itemVariant.thickness.item',
      ],
    });

    if (!request) {
      throw new NotFoundException(`Request with ID ${id} not found.`);
    }

    return {
      id: request.id,
      requestNumber: request.requestNumber,
      requestDate: request.requestDate,
      totalAmount: request.totalAmount,
      vatAmount: request.vatAmount,
      grandTotal: request.grandTotal,
      customerId: request.customer?.id || null, // ✅ Prevent null errors
      customerName: request.customer?.customerName || 'Unknown', // ✅ Fallback for missing name
      invoiceType: request.customer?.invoiceType || 'Both', // ✅ Default to 'Both' if missing
      details: request.details.map((detail) => ({
        itemVariantId: detail.itemVariant?.id || null,
        itemName: detail.itemVariant?.thickness?.item?.itemName || 'Unknown',
        thickness: detail.itemVariant?.thickness?.thickness || 'Unknown',
        length: detail.itemVariant?.length || 0,
        width: detail.itemVariant?.width || 0,
        origin: detail.itemVariant?.origin || 'Unknown',
        sheetsPerBox: detail.itemVariant?.sheetsPerBox || 0,
        itemType: detail.itemVariant?.thickness?.item?.type || 'Unknown',
        quantity: detail.quantity || 0,
        sqm: detail.sqm || 0,
        price: detail.price || 0,
        total: detail.total || 0,
      })),
    };
  }

async getFilteredRequests(page: number = 1, limit: number = 10) {
  // 🔒 Coerce + clamp — never trust inputs at runtime
  const pageNum  = Math.max(1, Number(page)  || 1);
  const limitNum = Math.min(500, Math.max(1, Number(limit) || 50));
  const skip     = (pageNum - 1) * limitNum;

  // Optional debug (remove later)
  console.log('[REQ] page/limit (raw):', page, limit, typeof page, typeof limit);
  console.log('[REQ] pageNum/limitNum/skip:', pageNum, limitNum, skip);

  const [requests, total] = await this.requestRepo.findAndCount({
    relations: [
      'customer',
      'details',
      'details.itemVariant',
      'details.itemVariant.thickness',
      'details.itemVariant.thickness.item',
    ],
    order: { id: 'DESC' },
    skip,           // ✅ number
    take: limitNum, // ✅ number
  });

  const response = {
    data: requests.map((request) => ({
      id: request.id,
      requestNumber: request.requestNumber,
      requestDate: request.requestDate,
      totalAmount: request.totalAmount,
      vatAmount: request.vatAmount,
      grandTotal: request.grandTotal,
      customerName: request.customer.customerName,
      invoiceType: request.customer.invoiceType,
    })),
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
  };

  this.requestGateway.sendFilteredRequests(response);
  return response;
}


  async updateRequest(id: number, data: any): Promise<Request> {
    const { requestDate, totalAmount, vatAmount, grandTotal, customerId, details } = data;

    // Check if request exists
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['details'],
    });
    if (!request) {
      throw new NotFoundException(`Request with ID ${id} not found.`);
    }

    // Validate customer
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Update the request details
    request.requestDate = requestDate;
    request.totalAmount = totalAmount;
    request.vatAmount = vatAmount;
    request.grandTotal = grandTotal;
    request.customer = customer;

    // Clear existing details and add new ones
    request.details = await Promise.all(
      details.map(async (detail) => {
        const { itemVariantId, quantity, sqm, price, total } = detail;

        const itemVariant = await this.itemVariantRepo.findOne({
          where: { id: itemVariantId },
        });

        if (!itemVariant) {
          throw new NotFoundException(`ItemVariant with ID ${itemVariantId} not found.`);
        }

        return this.detailRepo.create({
          itemVariant,
          quantity,
          sqm,
          price,
          total,
        });
      }),
    );

    // Save the updated request
    const updatedRequest = await this.requestRepo.save(request);

    // Return the updated request
    return updatedRequest;
  }




  // requests search list

  async searchFilteredRequests(
  q: string | undefined,
  page: number = 1,
  limit: number = 100,
): Promise<{
  data: Array<{
    id: number;
    requestNumber: string;
    requestDate: any;
    totalAmount: number;
    vatAmount: number;
    grandTotal: number;
    customerName: string | null;
    invoiceType: string | null;
  }>;
  total: number;
  page: number;
  totalPages: number;
}> {
  // ---- pagination guards ----
  const pageNum  = Math.max(1, Number(page)  || 1);
  const take     = Math.min(500, Math.max(1, Number(limit) || 100));
  const skip     = (pageNum - 1) * take;

  // ---- helpers ----
  const norm = (s?: string) => (s ?? "").trim();
  const QQ = norm(q);

  // Accepts 2025-10-19 or 2025/10/19 and returns 'YYYY-MM-DD' or null
  const asDate = (s: string) => {
    const t = (s || "").replace(/\//g, "-");
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
  };

  // Detect numeric-only query (e.g., "37") for suffix search
  const isNumericOnly = (s: string) => /^\d+$/.test(s);

  // Detect "looks like a request number" (any letters/digits with a hyphen or space)
  // e.g., REQ25-12, REQ25 - 12, REQ-12, etc. We’ll search with LIKE after removing spaces.
  const looksLikeRequestNo = (s: string) =>
    /[A-Za-z]/.test(s) || s.includes("-");

  // ---- base query ----
  const qb = this.requestRepo
    .createQueryBuilder("req")
    .leftJoinAndSelect("req.customer", "customer")
    .orderBy("req.id", "DESC")
    .skip(skip)
    .take(take);

  if (!QQ) {
    // no query => normal pagination
    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map(r => ({
        id: r.id,
        requestNumber: r.requestNumber,
        requestDate: r.requestDate,
        totalAmount: r.totalAmount,
        vatAmount: r.vatAmount,
        grandTotal: r.grandTotal,
        customerName: r.customer?.customerName ?? null,
        invoiceType: r.customer?.invoiceType ?? null,
      })),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / take),
    };
  }

  // ---- parse the query ----
  // 1) Date range: "YYYY-MM-DD..YYYY-MM-DD" (also allows "to" or a single hyphen between)
  const rangeMatch =
    QQ.match(/(\d{4}[-/]\d{2}[-/]\d{2})\s*(?:\.\.|to|-)\s*(\d{4}[-/]\d{2}[-/]\d{2})/i);
  // 2) Single date: "YYYY-MM-DD"
  const singleDateMatch = QQ.match(/^(\d{4}[-/]\d{2}[-/]\d{2})$/);

  if (rangeMatch) {
    const d1 = asDate(rangeMatch[1])!;
    const d2 = asDate(rangeMatch[2])!;
    if (d1 && d2) {
      qb.andWhere("req.requestDate BETWEEN :d1 AND :d2", { d1, d2 });
    }
  } else if (singleDateMatch) {
    const d = asDate(singleDateMatch[1])!;
    if (d) qb.andWhere("req.requestDate = :d", { d });
  } else if (isNumericOnly(QQ)) {
    // Numeric-only => match the numeric suffix after " - "
    // MySQL: CAST(SUBSTRING_INDEX(requestNumber, ' - ', -1) AS UNSIGNED)
    qb.andWhere(
      "CAST(SUBSTRING_INDEX(req.requestNumber, ' - ', -1) AS UNSIGNED) = :seq",
      { seq: Number(QQ) }
    );
  } else if (looksLikeRequestNo(QQ)) {
    // Looks like a request number => be flexible about spaces around hyphen
    // Compare after removing spaces from DB field:
    // REPLACE(req.requestNumber, ' ', '') LIKE %REQLike%
    const pat = `%${QQ.replace(/\s+/g, "")}%`;
    qb.andWhere("REPLACE(req.requestNumber, ' ', '') LIKE :pat", { pat });
  } else {
    // Customer name tokens (AND across tokens)
    const tokens = QQ.split(/\s+/).filter(Boolean);
    tokens.forEach((t, i) => {
      qb.andWhere(`customer.customerName LIKE :c${i}`, { [`c${i}`]: `%${t}%` });
    });
  }

  const [rows, total] = await qb.getManyAndCount();

  return {
    data: rows.map(r => ({
      id: r.id,
      requestNumber: r.requestNumber,
      requestDate: r.requestDate,
      totalAmount: r.totalAmount,
      vatAmount: r.vatAmount,
      grandTotal: r.grandTotal,
      customerName: r.customer?.customerName ?? null,
      invoiceType: r.customer?.invoiceType ?? null,
    })),
    total,
    page: pageNum,
    totalPages: Math.ceil(total / take),
  };
}


}
