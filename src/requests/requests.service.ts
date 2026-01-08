import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In,DataSource,Brackets  } from 'typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { Customer } from '../entities/customer.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Settings } from '../entities/settings.entity';
import { RequestGateway } from './requests.gateway';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';

@Injectable()
export class RequestService {
  constructor(
   @InjectRepository(Request) private readonly requestRepo: Repository<Request>,
    @InjectRepository(RequestDetail) private readonly detailRepo: Repository<RequestDetail>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(ItemVariant) private readonly itemVariantRepo: Repository<ItemVariant>,

    // ✅ if you have this repo in the constructor, it MUST be in forFeature in the module
    @InjectRepository(ItemBatch) private readonly itemBatchRepo: Repository<ItemBatch>,

    @InjectRepository(Settings) private readonly settingsRepo: Repository<Settings>,

    // ✅ NO decorator here
    private readonly dataSource: DataSource,

    private readonly requestGateway: RequestGateway,
  ) {}

async createRequest(data: any): Promise<Request> {
  const { requestDate, totalAmount, vatAmount,vatPercentage, grandTotal, customerId, details } = data;

  // ✅ Validate Customer
  const customer = await this.customerRepo.findOne({ where: { id: customerId } });
  if (!customer) throw new NotFoundException('Customer not found');

  // ✅ Get Active Year from Settings
  const activeYear = await this.settingsRepo.findOne({ where: { isActive: true } });
  if (!activeYear) throw new NotFoundException('No active year found in Settings.');

  const year = activeYear.year.slice(-2);
  const prefix = `REQ${year}`;

  // ✅ Find the last request number
  const lastRequest = await this.requestRepo
    .createQueryBuilder('request')
    .select("CAST(SUBSTRING_INDEX(request.requestNumber, ' - ', -1) AS UNSIGNED) AS maxNumber")
    .where('request.requestNumber LIKE :prefix', { prefix: `${prefix} - %` })
    .orderBy('maxNumber', 'DESC')
    .limit(1)
    .getRawOne();

  const newRequestNumber = lastRequest?.maxNumber ? parseInt(lastRequest.maxNumber) + 1 : 1;
  const requestNumber = `${prefix} - ${newRequestNumber}`;

  // ✅ Validate and Link Item Variants (+ ItemBatch)
  const requestDetails = await Promise.all(
    (details || []).map(async (detail) => {
      const { itemVariantId, itemBatchId, quantity, sqm, price, total } = detail;

      const itemVariant = await this.itemVariantRepo.findOne({
        where: { id: itemVariantId },
        relations: ['thickness', 'thickness.item'],
      });

      if (!itemVariant) {
        throw new NotFoundException(`ItemVariant with ID ${itemVariantId} not found.`);
      }

      // ✅ Load itemBatch from the id sent by frontend
      let itemBatch = null;
      if (itemBatchId !== null && itemBatchId !== undefined && Number(itemBatchId) > 0) {
        itemBatch = await this.itemBatchRepo.findOne({
          where: { id: Number(itemBatchId) },
        });

        if (!itemBatch) {
          throw new NotFoundException(`ItemBatch with ID ${itemBatchId} not found.`);
        }
      }

      return this.detailRepo.create({
        itemVariant,
        itemBatch, // ✅ THIS saves itemBatchId because of the relation
        quantity,
        sqm,
        price,
        total,
      });
    }),
  );

  // ✅ Create and Save Request
  const request = this.requestRepo.create({
    requestNumber,
    requestDate,
    totalAmount,
    vatAmount,
     vatPercentage: vatPercentage != null ? Number(vatPercentage) : 0,
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
     vatPercentage: savedRequest.vatPercentage,
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
      'details.itemBatch',
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
    vatPercentage: request.vatPercentage,
    customerId: request.customer?.id ?? null,
    customerName: request.customer?.customerName ?? 'Unknown',
    invoiceType: request.customer?.invoiceType ?? 'Both',

    details: (request.details || []).map((detail) => {
      const item = detail.itemVariant?.thickness?.item;
      const itemVariant = detail.itemVariant;

      // ✅ robust: prefer FK column if it exists, else relation
      const rawBatchId =
        (detail as any)?.itemBatchId ?? (detail as any)?.itemBatch?.id ?? null;

      const itemBatchId =
        rawBatchId !== null && rawBatchId !== undefined && Number(rawBatchId) > 0
          ? Number(rawBatchId)
          : null;

      return {
        itemVariantId: detail.itemVariant?.id ?? null,
        itemBatchId,

        // ✅ NEW: Include invoiceDisplayName
        itemName: item?.itemName ?? 'Unknown',
        invoiceDisplayName: itemVariant?.invoiceDisplayName ?? null,
        
        thickness: detail.itemVariant?.thickness?.thickness ?? 'Unknown',
        itemType: item?.type ?? 'Unknown',
        stockMode: item?.stockMode ?? 'SQM',

        length: detail.itemVariant?.length ?? 0,
        width: detail.itemVariant?.width ?? 0,
        origin: detail.itemVariant?.origin ?? 'Unknown',
        sheetsPerBox: detail.itemVariant?.sheetsPerBox ?? 0,

        quantity: detail.quantity ?? 0,
        sqm: detail.sqm ?? 0,
        price: detail.price ?? 0,
        total: detail.total ?? 0,
      };
    }),
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
      vatPercentage: request.vatPercentage,
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
  const { requestDate, totalAmount, vatAmount, vatPercentage, grandTotal, customerId, details } = data;

  if (!Array.isArray(details) || details.length === 0) {
    throw new BadRequestException('details must be a non-empty array');
  }

  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();

  try {
    // 1) Load request
    const request = await qr.manager.findOne(Request, {
      where: { id },
      relations: ['details'],
    });

    if (!request) {
      throw new NotFoundException(`Request with ID ${id} not found.`);
    }

    // 2) Validate customer
    const customer = await qr.manager.findOne(Customer, { where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    // 3) Validate itemVariantIds in one shot
    const variantIds = Array.from(
      new Set(details.map((d) => Number(d.itemVariantId)).filter((x) => Number.isInteger(x) && x > 0)),
    );

    if (!variantIds.length) {
      throw new BadRequestException('details.itemVariantId missing/invalid');
    }

    const variants = await qr.manager.find(ItemVariant, {
      where: { id: In(variantIds) } as any,
    });

    if (variants.length !== variantIds.length) {
      const found = new Set(variants.map((v) => v.id));
      const missing = variantIds.filter((x) => !found.has(x));
      throw new NotFoundException(`ItemVariant not found for ids: ${missing.join(', ')}`);
    }

    const variantById = new Map<number, ItemVariant>(variants.map((v) => [v.id, v]));

    // 4) Validate itemBatchIds (only if provided) in one shot
    const batchIds = Array.from(
      new Set(details.map((d) => d.itemBatchId).filter((x) => x !== null && x !== undefined).map(Number)),
    ).filter((x) => Number.isInteger(x) && x > 0);

    let batchById = new Map<number, ItemBatch>();
    if (batchIds.length) {
      const batches = await qr.manager.find(ItemBatch, {
        where: { id: In(batchIds) } as any,
      });

      if (batches.length !== batchIds.length) {
        const found = new Set(batches.map((b) => b.id));
        const missing = batchIds.filter((x) => !found.has(x));
        throw new NotFoundException(`ItemBatch not found for ids: ${missing.join(', ')}`);
      }

      batchById = new Map<number, ItemBatch>(batches.map((b) => [b.id, b]));
    }

    // 5) Update request header fields
    request.requestDate = requestDate;
    request.totalAmount = totalAmount;
    request.vatAmount = vatAmount;
    request.grandTotal = grandTotal;
        request.vatPercentage = vatPercentage != null ? Number(vatPercentage) : 0;

    request.customer = customer;

    await qr.manager.save(Request, request);

    // 6) Delete old details
    // If you have requestId column in RequestDetail, this is very solid:
    await qr.manager.delete(RequestDetail, { request: { id } as any } as any);

    // 7) Insert new details
    const newDetails = details.map((d) => {
      const itemVariantId = Number(d.itemVariantId);
      const itemBatchId =
        d.itemBatchId === null || d.itemBatchId === undefined ? null : Number(d.itemBatchId);

      const itemVariant = variantById.get(itemVariantId)!;

      const detailEntity: Partial<RequestDetail> = {
        request, // link to parent
        itemVariant,
        quantity: Number(d.quantity) || 0,
        sqm: Number(d.sqm) || 0,
        price: Number(d.price) || 0,
        total: Number(d.total) || 0,
      };

      // ✅ Save batch if provided
      if (itemBatchId && batchById.size) {
        // If you have a relation: detailEntity.itemBatch = batchById.get(itemBatchId)
        // If you have a raw column: detailEntity.itemBatchId = itemBatchId
        (detailEntity as any).itemBatchId = itemBatchId;

        // If you ALSO have a relation field and want it populated:
        if ((RequestDetail.prototype as any).itemBatch !== undefined) {
          (detailEntity as any).itemBatch = batchById.get(itemBatchId);
        }
      } else {
        // allow null (recommended)
        (detailEntity as any).itemBatchId = null;
        if ((RequestDetail.prototype as any).itemBatch !== undefined) {
          (detailEntity as any).itemBatch = null;
        }
      }

      return qr.manager.create(RequestDetail, detailEntity);
    });

    await qr.manager.save(RequestDetail, newDetails);

    await qr.commitTransaction();

    // 8) Return fresh request with relations (including batch if you added it)
    const updated = await this.requestRepo.findOne({
      where: { id },
      relations: [
        'customer',
        'details',
        'details.itemVariant',
        'details.itemVariant.thickness',
        'details.itemVariant.thickness.item',
        // add these only if they exist on entity:
        'details.itemBatch',
      ] as any,
    });

    return updated as Request;
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
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
  const pageNum = Math.max(1, Number(page) || 1);
  const take = Math.min(500, Math.max(1, Number(limit) || 100));
  const skip = (pageNum - 1) * take;

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

  const isNumericOnly = (s: string) => /^\d+$/.test(s);
  const looksLikeRequestNo = (s: string) => /[A-Za-z]/.test(s) || s.includes("-");

  // ---- base query ----
  const qb = this.requestRepo
    .createQueryBuilder("req")
    .leftJoinAndSelect("req.customer", "customer")
    .orderBy("req.id", "DESC")
    .skip(skip)
    .take(take);

  if (!QQ) {
    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map((r) => ({
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
  const rangeMatch = QQ.match(
    /(\d{4}[-/]\d{2}[-/]\d{2})\s*(?:\.\.|to|-)\s*(\d{4}[-/]\d{2}[-/]\d{2})/i
  );
  const singleDateMatch = QQ.match(/^(\d{4}[-/]\d{2}[-/]\d{2})$/);

  // helper: AND across tokens, but each token can match ANY field (OR)
  const applyTokenSearch = (tokens: string[]) => {
    tokens.forEach((tok, i) => {
      const key = `t${i}`;
      const val = `%${tok.toLowerCase()}%`;

      qb.andWhere(
        new Brackets((b) => {
          b.where("LOWER(req.requestNumber) LIKE :rn_" + key, { ["rn_" + key]: val })
            .orWhere("LOWER(customer.customerName) LIKE :cname_" + key, { ["cname_" + key]: val })
            .orWhere("LOWER(customer.firstName) LIKE :fn_" + key, { ["fn_" + key]: val })
            .orWhere("LOWER(customer.middleName) LIKE :mn_" + key, { ["mn_" + key]: val })
            .orWhere("LOWER(customer.lastName) LIKE :ln_" + key, { ["ln_" + key]: val });
        })
      );
    });
  };

  if (rangeMatch) {
    const d1 = asDate(rangeMatch[1]);
    const d2 = asDate(rangeMatch[2]);
    if (d1 && d2) qb.andWhere("req.requestDate BETWEEN :d1 AND :d2", { d1, d2 });
  } else if (singleDateMatch) {
    const d = asDate(singleDateMatch[1]);
    if (d) qb.andWhere("req.requestDate = :d", { d });
  } else if (isNumericOnly(QQ)) {
    // Keep your numeric suffix behavior, BUT also allow matching customer fields / requestNumber generally
    qb.andWhere(
      new Brackets((b) => {
        b.where(
          "CAST(SUBSTRING_INDEX(req.requestNumber, ' - ', -1) AS UNSIGNED) = :seq",
          { seq: Number(QQ) }
        )
          .orWhere("LOWER(req.requestNumber) LIKE :rn", { rn: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.customerName) LIKE :cname", { cname: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.firstName) LIKE :fn", { fn: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.middleName) LIKE :mn", { mn: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.lastName) LIKE :ln", { ln: `%${QQ.toLowerCase()}%` });
      })
    );
  } else if (looksLikeRequestNo(QQ)) {
    // request number search (spaces-insensitive) OR names
    const pat = `%${QQ.replace(/\s+/g, "").toLowerCase()}%`;

    qb.andWhere(
      new Brackets((b) => {
        b.where("LOWER(REPLACE(req.requestNumber, ' ', '')) LIKE :pat", { pat })
          .orWhere("LOWER(customer.customerName) LIKE :cname", { cname: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.firstName) LIKE :fn", { fn: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.middleName) LIKE :mn", { mn: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.lastName) LIKE :ln", { ln: `%${QQ.toLowerCase()}%` });
      })
    );
  } else {
    const tokens = QQ.split(/\s+/).filter(Boolean);
    applyTokenSearch(tokens);
  }

  const [rows, total] = await qb.getManyAndCount();

  return {
    data: rows.map((r) => ({
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
