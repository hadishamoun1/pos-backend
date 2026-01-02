// src/inventory-count/inventory-count.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { CountType } from '../entities/inventory/count.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';
import { DataSource } from 'typeorm';
import { PurchaseInvoiceItem } from 'src/entities/Purchase-Invoice/purchase-invoice-item.entity'; // adjust path

@Injectable()
export class InventoryCountService {
  constructor(
    @InjectRepository(InventoryCount)
    private readonly inventoryCountRepo: Repository<InventoryCount>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepo: Repository<ItemVariant>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTxnRepo: Repository<InventoryTransaction>,

    @InjectRepository(ItemBatch)
    private readonly itemBatchRepo: Repository<ItemBatch>,

    @InjectRepository(ItemNameDescription)
    private readonly itemNameDescriptionRepo: Repository<ItemNameDescription>,
    @InjectRepository(PurchaseInvoiceItem)
private readonly purchaseInvoiceItemRepo: Repository<PurchaseInvoiceItem>,


    private readonly dataSource: DataSource,

  ) {}

  async create(
    createData: any | any[],
  ): Promise<InventoryCount | InventoryCount[]> {
    if (Array.isArray(createData)) {
      const results: InventoryCount[] = [];
      for (const row of createData) {
        results.push(await this.createSingle(row));
      }
      return results;
    }
    return this.createSingle(createData);
  }

  /** Accepts single or array of count-rows */
  async createSingle(data: any): Promise<InventoryCount> {
    const {
      itemBatchId,
      date,
      count,
      type,
      unit,
      countOFR = 0,
      finalCost = 0,
      finalCostOfr = 0,
    } = data;

    // 1) fetch the batch (and variant)
    const batch = await this.itemBatchRepo.findOne({
      where: { id: itemBatchId },
      relations: ['itemVariant'],
    });
    if (!batch) {
      throw new NotFoundException(`ItemBatch #${itemBatchId} not found`);
    }
    const variant = batch.itemVariant;

    // 2) compute one‐sheet area (cm² → m²)
    const oneSheetM2 = (Number(variant.length) * Number(variant.width)) / 10000;

    // 3) figure out sqm & sqmofr
    let rawSqm: number, rawSqmofr: number;
    switch (unit) {
      case 'box':
        rawSqm = oneSheetM2 * variant.sheetsPerBox * count;
        rawSqmofr = oneSheetM2 * variant.sheetsPerBox * countOFR;
        break;
      case 'sheet':
        rawSqm = oneSheetM2 * count;
        rawSqmofr = oneSheetM2 * countOFR;
        break;
      case 'sqm':
        rawSqm = count;
        rawSqmofr = countOFR;
        break;
      default:
        rawSqm = rawSqmofr = 0;
    }
    let sqm = Number(rawSqm.toFixed(2));
    const sqmofr = Number(rawSqmofr.toFixed(2));
if (type === 'G') sqm = 0;
    // 4) compute finalCost fields
    let fc = 0,
      fco = 0;
    if (type === 'S') {
      fc = finalCost;
      fco = finalCost;
    } else if (type === 'G') {
      fco = finalCostOfr;
    } else if (type === 'RVR') {
      fc = finalCost;
    } else if (type === 'SR') {
      fc = finalCost;
      fco = finalCostOfr;
    }
    if (Number(fc) > 0) {
  variant.averageCost = Number(Number(fc).toFixed(2));
}
if (Number(fco) > 0) {
  variant.averageCostVM = Number(Number(fco).toFixed(2));
}
if (type === 'RVR' && Number(fc) > 0 && (variant as any).itemNameDescription) {
  (variant as any).itemNameDescription.averageCostCVM = Number(Number(fc).toFixed(2));
  await this.itemNameDescriptionRepo.save((variant as any).itemNameDescription);
}


    // 5) save the InventoryCount
    const inventoryCount = this.inventoryCountRepo.create({
      itemVariant: variant,
      date,
      count,
      type,
      sqm,
      sqmOfr: sqmofr,  
      finalCost: fc,
      finalCostOfr: fco,
    });
    const savedCount = await this.inventoryCountRepo.save(inventoryCount);

    // 6) derive txn quantities
    let qty = 0,
      qtyOFR = 0;
    if (type === 'S') {
      qty = count;
      qtyOFR = count;
    } else if (type === 'SR') {
      qty = count;
      qtyOFR = countOFR;
    } else if (type === 'G') {
      qtyOFR = count;
    } else if (type === 'RVR') {
      qty = count;
    }

    // 7) save the InventoryTransaction
    const txn = this.inventoryTxnRepo.create({
      itemVariant: variant,
      itemBatchId: itemBatchId,
      transactionType: 'Count',
      sqm,
      sqmofr,
      quantity: qty,
      quantityofr: qtyOFR,
      inventoryCountId: savedCount.id,
      finalcost: fc,
      finalcostofr: fco,
      dateForEachInvoice: new Date(savedCount.date),
    });
    await this.inventoryTxnRepo.save(txn);

    // 8) **update batch & variant totals** per your rules
    switch (type) {
      case 'RVR':
        batch.start = Number(batch.start) + sqm;
        variant.totalStart = Number(variant.totalStart) + sqm;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        break;

      case 'S':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqm;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqm;

        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;

      case 'G':
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;

        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);

        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;

      case 'SR':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);
        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;
    }

    await this.itemBatchRepo.save(batch);
    await this.itemVariantRepo.save(variant);

    return savedCount;
  }

  findAll(): Promise<InventoryCount[]> {
    return this.inventoryCountRepo.find({ relations: ['itemVariant'] });
  }

  async findOne(id: number): Promise<InventoryCount> {
    const rec = await this.inventoryCountRepo.findOne({
      where: { id },
      relations: ['itemVariant'],
    });
    if (!rec) {
      throw new NotFoundException(`InventoryCount #${id} not found`);
    }
    return rec;
  }

  async getFilteredCounts(): Promise<any[]> {
    const counts = await this.inventoryCountRepo.find({
      relations: [
        'itemVariant',
        'itemVariant.thickness',
        'itemVariant.thickness.item',
        'itemVariant.batches',
      ],
      order: { id: 'DESC' },
    });

    return counts.map((cnt) => {
      const v = cnt.itemVariant!;
      const t = v.thickness!;
      const item = t.item!;
      const batches = v.batches || [];

      return {
        // the count’s own ID
        id: cnt.id,

        // ▶︎ newly added fields:
        itemVariantName: item.itemName,
        thickness: Number(t.thickness),

        // variant dimensions & meta
        length: Number(v.length),
        width: Number(v.width),
        sheetsPerBox: v.sheetsPerBox,
        origin: v.origin,
        itemVariantType: item.type,

        // count details
        date: cnt.date,
        count: cnt.count,
        sqm: Number(cnt.sqm),
        type: cnt.type,
        finalCost: Number(cnt.finalCost),
        finalCostOfr: Number(cnt.finalCostOfr),
        itemBatches: batches.map((b) => ({
          id: b.id,
          condition: b.condition,
          dateReceived: b.dateReceived,
        })),
      };
    });
  }






  private ARABIC_INDIC_MAP: Record<string, string> = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
  };
  private normalizeDigitsAll = (input: string) =>
    String(input || '').replace(/[٠-٩۰-۹]/g, d => this.ARABIC_INDIC_MAP[d] ?? d);
  private normalizeArabicAlef = (s: string) =>
    String(s || '').replace(/أ|إ|آ/g, 'ا');

  /**
   * Parse a free-text query like:
   *  - "5.5ملم ابيض"
   *  - "225*321-027" (supports x, ×, *)
   *  - mixed: "5.5 ملم ابيض 225×321-27"
   */
  private parseSearchQuery(qRaw: string): {
    thickness?: number;
    length?: number;
    width?: number;
    sheetsPerBox?: number;
    nameTokens?: string[];
  } {
    if (!qRaw) return {};
    let q = this.normalizeDigitsAll(qRaw).trim().replace(/\s+/g, ' ');
    let working = q;

    // thickness: "10ملم" / "10 مم" / "10مم" / "10 ملم"
    const thMatch = working.match(/(\d+(?:[.,]\d+)?)\s*(?:ملم|مم|م)(?=$|\s|[-/xX×*])/);
    let thickness: number | undefined;
    if (thMatch) {
      const th = Number((thMatch[1] || '').replace(',', '.'));
      if (Number.isFinite(th)) thickness = th;
      working = working.replace(thMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

    // dims + optional SPB: 225*321-027 | 225×321/27 | 225x321 - 27
    const dimRe = /(\d{2,5})\s*[xX×*]\s*(\d{2,5})(?:\s*[-/]\s*0?(\d{1,3}))?/;
    const dimMatch = working.match(dimRe);
    let lengthN: number | undefined;
    let widthN: number | undefined;
    let spb: number | undefined;
    if (dimMatch) {
      lengthN = Number(dimMatch[1]);
      widthN  = Number(dimMatch[2]);
      if (dimMatch[3] != null) spb = Number(dimMatch[3]);
      working = working.replace(dimMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

    // clear unit words
    working = working
      .replace(/(?:^|[\s\-_/\\])(?:ملم|مم|م)(?=$|[\s\-_/\\])/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // leftover tokens (item name / color / etc.)
    let nameTokens: string[] | undefined;
    if (working) {
      const tokens = working.split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 2);
      if (tokens.length) nameTokens = tokens;
    }

    return {
      thickness,
      length: lengthN,
      width: widthN,
      sheetsPerBox: spb,
      nameTokens,
    };
  }

 // In your service
 // in src/count/count.service.ts

// src/count/count.service.ts

async searchVariants(params: {
  q?: string;
  mode: 'name' | 'real';                 // kept for parity (not used in latest-count logic)
  itemName?: string;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  thickness?: number;
  length?: number;
  width?: number;
  sheetsPerBox?: number;
  origin?: string;
  page: number;
  limit: number;
}) {
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(200, Math.max(1, Number(params.limit || 50)));

  const qb = this.itemVariantRepo
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoinAndSelect('v.batches', 'b')
    .select([
      'v.id',
      'v.length',
      'v.width',
      'v.sheetsPerBox',
      'v.origin',
      't.id',
      't.thickness',
      'i.id',
      'i.itemName',
      'i.type',
      'b.id',
      'b.condition',
      'b.dateReceived',
    ])
    .distinct(true);

  // --- ONLY variants that appear in inventory_count ---
  const existsSub = qb
    .subQuery()
    .select('1')
    .from('inventory_count', 'ic')
    .where('ic.itemVariantId = v.id')
    .getQuery();
  qb.andWhere(`EXISTS ${existsSub}`);

  // helper to add latest inventory_count scalar as raw column
  const addLatest = (col: string, alias: string) => {
    const sub = `
      (
        SELECT ic.${col}
        FROM inventory_count ic
        WHERE ic.itemVariantId = v.id
        ORDER BY ic.date DESC, ic.id DESC
        LIMIT 1
      )
    `;
    qb.addSelect(sub, alias);
  };

  addLatest('id',           'lc_id');
  addLatest('date',         'lc_date');
  addLatest('count',        'lc_count');
  addLatest('sqm',          'lc_sqm');
  addLatest('type',         'lc_type');
  addLatest('finalCost',    'lc_finalCost');
  addLatest('finalCostOfr', 'lc_finalCostOfr');

  // --- parse "q" like: 5.5ملم ابيض 225*321-027
  const parseSearchQuery = (q: string) => {
    let src = (q || '').trim();
    src = src.replace(/[xX×]/g, '*').replace(/\s+/g, ' ');
    const thkM = src.match(/(\d+(?:\.\d+)?)\s*م?\s*ل?\s*م/);
    const thickness = thkM ? Number(thkM[1]) : undefined;
    if (thkM) src = src.replace(thkM[0], ' ');
    const dimM = src.match(/(\d{2,4})\s*\*\s*(\d{2,4})(?:\s*-\s*(\d{1,3}))?/);
    const length = dimM ? Number(dimM[1]) : undefined;
    const width = dimM ? Number(dimM[2]) : undefined;
    const sheetsPerBox = dimM && dimM[3] != null ? Number(dimM[3]) : undefined;
    if (dimM) src = src.replace(dimM[0], ' ');
    const normalizeArabicAlef = (s: string) => String(s || '').replace(/[أإآ]/g, 'ا');
    const leftover = normalizeArabicAlef(src).trim();
    const nameTokens = leftover ? leftover.split(/\s+/).filter(Boolean) : [];
    return { thickness, length, width, sheetsPerBox, nameTokens, normalizeArabicAlef };
  };

  const parsed = parseSearchQuery(params.q || '');

  // filters from q
  if (Number.isFinite(parsed.thickness)) {
    qb.andWhere('ROUND(t.thickness, 1) = ROUND(:pth, 1)', { pth: Number(parsed.thickness) });
  }
  if (Number.isFinite(parsed.length)) qb.andWhere('v.length = :plen', { plen: Number(parsed.length) });
  if (Number.isFinite(parsed.width))  qb.andWhere('v.width  = :pwid', { pwid: Number(parsed.width) });
  if (Number.isFinite(parsed.sheetsPerBox)) {
    qb.andWhere('v.sheetsPerBox = :pspb', { pspb: Number(parsed.sheetsPerBox) });
  }
  if (parsed.nameTokens?.length) {
    parsed.nameTokens.forEach((tok, idx) => {
      const norm = `%${parsed.normalizeArabicAlef(tok)}%`;
      const raw  = `%${tok}%`;
      qb.andWhere(
        `(
          REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :n${idx}
          OR i.itemName LIKE :r${idx}
        )`,
        { [`n${idx}`]: norm, [`r${idx}`]: raw },
      );
    });
  }

  // explicit filters
  if (params.itemName) {
    const normName = String(params.itemName).replace(/[أإآ]/g, 'ا');
    qb.andWhere(
      `(REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :nm OR i.itemName LIKE :nmRaw)`,
      { nm: `%${normName}%`, nmRaw: `%${params.itemName}%` },
    );
  }
  if (params.type) qb.andWhere('i.type = :tp', { tp: params.type });
  if (Number.isFinite(params.thickness)) qb.andWhere('ROUND(t.thickness, 1) = ROUND(:th, 1)', { th: Number(params.thickness) });
  if (Number.isFinite(params.length))    qb.andWhere('v.length = :len', { len: Number(params.length) });
  if (Number.isFinite(params.width))     qb.andWhere('v.width  = :wid', { wid: Number(params.width) });
  if (Number.isFinite(params.sheetsPerBox)) qb.andWhere('v.sheetsPerBox = :spb', { spb: Number(params.sheetsPerBox) });
  if (params.origin) qb.andWhere('v.origin = :org', { org: params.origin });

  qb
    .addOrderBy('i.itemName', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.width', 'ASC')
    .addOrderBy('v.id', 'ASC')
    .skip((page - 1) * limit)
    .take(limit);

  const { raw, entities } = await qb.getRawAndEntities();

  const data = entities.map((v, idx) => {
    const r: any = raw[idx];
    const batches = (v.batches ?? []).map((b: any) => ({
      id: b.id,
      condition: b.condition ?? null,
      dateReceived: b.dateReceived ?? null,
    }));

    const lcDate = r['lc_date'];
    const dateISO =
      lcDate == null
        ? null
        : lcDate instanceof Date
        ? lcDate.toISOString()
        : String(lcDate);

    return {
      id: r['lc_id'] != null ? Number(r['lc_id']) : null,
      itemVariantName: v.thickness.item.itemName,
      thickness: Number(v.thickness.thickness),
      length: Number(v.length),
      width: Number(v.width),
      sheetsPerBox: Number(v.sheetsPerBox),
      origin: v.origin,
      itemVariantType: v.thickness.item.type as 'box' | 'sheet' | 'sqm' | 'unit',

      date: dateISO,
      count: r['lc_count'] != null ? Number(r['lc_count']) : null,
      sqm: r['lc_sqm'] != null ? Number(r['lc_sqm']) : null,
      type: r['lc_type'] ?? null,
      finalCost: r['lc_finalCost'] != null ? Number(r['lc_finalCost']) : null,
      finalCostOfr: r['lc_finalCostOfr'] != null ? Number(r['lc_finalCostOfr']) : null,

      itemBatches: batches,
    };
  });

  return { page, limit, total: data.length, data };
}







  // Add this new method in your `InventoryCountService`

  async getFilteredCountsWithBatchBalance(): Promise<any[]> {
    const counts = await this.inventoryCountRepo.find({
      relations: [
        'itemVariant',
        'itemVariant.thickness',
        'itemVariant.thickness.item',
        'itemVariant.batches',
      ],
      order: { id: 'DESC' },
    });

    return counts.map((cnt) => {
      const v = cnt.itemVariant!;
      const t = v.thickness!;
      const item = t.item!;
      const batches = v.batches || [];

      return {
        id: cnt.id,
        itemVariantName: item.itemName,
        thickness: Number(t.thickness),
        length: Number(v.length),
        width: Number(v.width),
        sheetsPerBox: v.sheetsPerBox,
        origin: v.origin,
        itemVariantType: item.type,
        date: cnt.date,
        count: cnt.count,
        sqm: Number(cnt.sqm),
        type: cnt.type,
        finalCost: Number(cnt.finalCost),
        finalCostOfr: Number(cnt.finalCostOfr),
        itemBatches: batches.map((b) => ({
          id: b.id,
          condition: b.condition,
          dateReceived: b.dateReceived,
          start: b.start,
          startOFR: b.startOFR,
          balance: b.balance,
          balanceOFR: b.balanceOFR,
        })),
      };
    });
  }
 async update(
  id: number,
  data: {
    itemBatchId?: number;
    date?: string;
    count?: number;
    unit?: 'box' | 'sheet' | 'sqm';
    countOFR?: number;          // IMPORTANT: SR needs this provided (since it's not stored in InventoryCount)
    type?: CountType;
    finalCost?: number;
    finalCostOfr?: number;
  },
): Promise<InventoryCount> {
  const round2 = (n: any) => Number((Number(n || 0)).toFixed(2));
  const hasVal = (v: any) => v !== undefined && v !== null && String(v).trim() !== '';

  const normalizeDateYYYYMMDD = (v: any): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    // if already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // fallback: Date parse
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  };

  // Load count with variant (+ description if you use it)
  const countRec = await this.inventoryCountRepo.findOne({
    where: { id },
    relations: ['itemVariant', 'itemVariant.itemNameDescription'],
  });
  if (!countRec) throw new NotFoundException(`InventoryCount #${id} not found`);

  // Load the transaction attached to this count
  const txn = await this.inventoryTxnRepo.findOne({
    where: { inventoryCountId: id },
  });
  if (!txn) {
    throw new NotFoundException(`InventoryTransaction for count #${id} not found`);
  }

  // Old batch/variant (must exist for opening count)
  if (!txn.itemBatchId) {
    throw new NotFoundException(`ItemBatchId missing on txn for count #${id}`);
  }

  const oldBatch = await this.itemBatchRepo.findOne({
    where: { id: txn.itemBatchId },
    relations: ['itemVariant', 'itemVariant.itemNameDescription'],
  });
  if (!oldBatch) throw new NotFoundException(`ItemBatch #${txn.itemBatchId} not found`);

  const oldVariant = oldBatch.itemVariant;
  if (!oldVariant) throw new NotFoundException(`Old ItemVariant not found for batch #${oldBatch.id}`);

  // Snapshot old values used for rollback (use txn.sqm / txn.sqmofr as truth)
  const oldSqm = round2(txn.sqm);
  const oldSqmOfr = round2(txn.sqmofr);
  const originalType = countRec.type;

  // ─────────────────────────────
  // ROLLBACK old effect
  // ─────────────────────────────
  switch (originalType) {
    case CountType.RVR:
      oldBatch.start = round2(Number(oldBatch.start || 0) - oldSqm);
      oldVariant.totalStart = round2(Number(oldVariant.totalStart || 0) - oldSqm);
      break;

    case CountType.S:
      oldBatch.start = round2(Number(oldBatch.start || 0) - oldSqm);
      oldBatch.startOFR = oldBatch.start; // S mirrors
      oldVariant.totalStart = round2(Number(oldVariant.totalStart || 0) - oldSqm);
      oldVariant.totalStartOFR = oldVariant.totalStart;
      break;

    case CountType.G:
      oldBatch.startOFR = round2(Number(oldBatch.startOFR || 0) - oldSqmOfr);
      oldVariant.totalStartOFR = round2(Number(oldVariant.totalStartOFR || 0) - oldSqmOfr);
      break;

    case CountType.SR:
      oldBatch.start = round2(Number(oldBatch.start || 0) - oldSqm);
      oldBatch.startOFR = round2(Number(oldBatch.startOFR || 0) - oldSqmOfr);
      oldVariant.totalStart = round2(Number(oldVariant.totalStart || 0) - oldSqm);
      oldVariant.totalStartOFR = round2(Number(oldVariant.totalStartOFR || 0) - oldSqmOfr);
      break;
  }

  // ─────────────────────────────
  // Decide new batch/variant
  // ─────────────────────────────
  let newBatch = oldBatch;
  let newVariant = oldVariant;

  if (data.itemBatchId != null && data.itemBatchId !== oldBatch.id) {
    const found = await this.itemBatchRepo.findOne({
      where: { id: data.itemBatchId },
      relations: ['itemVariant', 'itemVariant.itemNameDescription'],
    });
    if (!found) throw new NotFoundException(`ItemBatch #${data.itemBatchId} not found`);
    if (!found.itemVariant) throw new NotFoundException(`ItemVariant missing on ItemBatch #${found.id}`);

    newBatch = found;
    newVariant = found.itemVariant;

    countRec.itemVariant = newVariant;
    countRec.itemVariantId = newVariant.id; // safety
  }

  // ─────────────────────────────
  // Apply new inputs to countRec (date/count/type/costs)
  // ─────────────────────────────
  const nextType: CountType = (data.type ?? countRec.type) as CountType;

  const nextDateStr =
    normalizeDateYYYYMMDD(data.date) ??
    normalizeDateYYYYMMDD(countRec.date) ??
    normalizeDateYYYYMMDD(txn.dateForEachInvoice) ??
    null;

  if (!nextDateStr) {
    throw new NotFoundException(`Invalid date for InventoryCount #${id}`);
  }

  const nextCount = Number(data.count ?? countRec.count ?? 0);
  const unit: 'box' | 'sheet' | 'sqm' = (data.unit ?? 'sheet') as any;

  // SR needs countOFR; if not provided, we fall back to count
  const nextCountOfr = Number(hasVal(data.countOFR) ? data.countOFR : nextCount);

  // Costs like createSingleopening
  const inFinalCost = Number(data.finalCost ?? countRec.finalCost ?? 0);
  const inFinalCostOfr = Number(data.finalCostOfr ?? countRec.finalCostOfr ?? 0);

  let fc = 0;
  let fco = 0;
  if (nextType === CountType.S) {
    fc = inFinalCost;
    fco = inFinalCost;
  } else if (nextType === CountType.G) {
    fc = 0;
    fco = inFinalCostOfr;
  } else if (nextType === CountType.RVR) {
    fc = inFinalCost;
    fco = 0;
  } else if (nextType === CountType.SR) {
    fc = inFinalCost;
    fco = inFinalCostOfr;
  }

  // Store updated count fields
  countRec.date = nextDateStr as any;
  countRec.count = nextCount;
  countRec.type = nextType;
  countRec.finalCost = round2(fc);
  countRec.finalCostOfr = round2(fco);

  // ─────────────────────────────
  // Compute sqm + sqmOfr (same style as createSingleopening)
  // ─────────────────────────────
  const oneM2 = (Number(newVariant.length) * Number(newVariant.width)) / 10000;

  let rawSqm = 0;
  let rawSqmOfr = 0;

  // For G: OFR count is the normal count; for others: OFR can differ (SR)
  const countForOfr = nextType === CountType.G ? nextCount : nextCountOfr;

  switch (unit) {
    case 'box':
      rawSqm = oneM2 * Number(newVariant.sheetsPerBox || 0) * nextCount;
      rawSqmOfr = oneM2 * Number(newVariant.sheetsPerBox || 0) * countForOfr;
      break;
    case 'sheet':
      rawSqm = oneM2 * nextCount;
      rawSqmOfr = oneM2 * countForOfr;
      break;
    case 'sqm':
      rawSqm = nextCount;
      rawSqmOfr = countForOfr;
      break;
  }

  const sqm = round2(rawSqm);
  const sqmOfr = round2(rawSqmOfr);

  countRec.sqm = sqm;
  // ✅ you added sqmOfr on InventoryCount, so keep it updated
  (countRec as any).sqmOfr = sqmOfr;

  // Optional: push opening costs into variant like your create (FIXED mapping)
  // averageCost   <- finalCost (fc)
  // averageCostVM <- finalCostOfr (fco)
  if (fc > 0) {
    newVariant.averageCostVM = round2(fc);
  }
  if (fco > 0) {
    newVariant.averageCost = round2(fco);
  }

  // Special: type=RVR push fc into itemNameDescription.averageCostCVM (like create)
  if (nextType === CountType.RVR && fc > 0 && (newVariant as any).itemNameDescription) {
    (newVariant as any).itemNameDescription.averageCostCVM = round2(fc);
    if (this.itemNameDescriptionRepo) {
      await this.itemNameDescriptionRepo.save((newVariant as any).itemNameDescription);
    }
  }

  // ─────────────────────────────
  // Update transaction fields (sqm/qty/date/batch/variant/cost)
  // ─────────────────────────────
  let txnSqm = 0;
  let txnSqmOfr = 0;
  let qty = 0;
  let qtyOfr = 0;

  switch (nextType) {
    case CountType.S:
      txnSqm = sqm;
      txnSqmOfr = sqm;
      qty = nextCount;
      qtyOfr = nextCount;
      break;

    case CountType.G:
      txnSqm = 0;
      txnSqmOfr = sqmOfr;
      qty = 0;
      qtyOfr = nextCount; // G uses normal count as OFR quantity
      break;

    case CountType.RVR:
      txnSqm = sqm;
      txnSqmOfr = 0;
      qty = nextCount;
      qtyOfr = 0;
      break;

    case CountType.SR:
      txnSqm = sqm;
      txnSqmOfr = sqmOfr;
      qty = nextCount;
      qtyOfr = nextCountOfr;
      break;
  }

  txn.sqm = round2(txnSqm);
  txn.sqmofr = round2(txnSqmOfr);
  txn.quantity = qty;
  txn.quantityofr = qtyOfr;

  txn.finalcost = round2(fc);
  txn.finalcostofr = round2(fco);

  txn.itemVariant = newVariant;
  txn.itemVariantId = newVariant.id;

  txn.itemBatchId = newBatch.id;

  // ✅ critical: keep sorting date aligned
  txn.dateForEachInvoice = new Date(nextDateStr);

  // keep your transactionType (or force it)
  // txn.transactionType = 'Opening Count';

  // ─────────────────────────────
  // APPLY new effect to batch/variant totals
  // Use txnSqm/txnSqmOfr as the exact applied values
  // ─────────────────────────────
  const appliedSqm = round2(txn.sqm);
  const appliedSqmOfr = round2(txn.sqmofr);

  switch (nextType) {
    case CountType.RVR:
      newBatch.start = round2(Number(newBatch.start || 0) + appliedSqm);
      newVariant.totalStart = round2(Number(newVariant.totalStart || 0) + appliedSqm);
      break;

    case CountType.S:
      newBatch.start = round2(Number(newBatch.start || 0) + appliedSqm);
      newBatch.startOFR = newBatch.start; // mirror
      newVariant.totalStart = round2(Number(newVariant.totalStart || 0) + appliedSqm);
      newVariant.totalStartOFR = newVariant.totalStart;
      break;

    case CountType.G:
      newBatch.startOFR = round2(Number(newBatch.startOFR || 0) + appliedSqmOfr);
      newVariant.totalStartOFR = round2(Number(newVariant.totalStartOFR || 0) + appliedSqmOfr);
      break;

    case CountType.SR:
      newBatch.start = round2(Number(newBatch.start || 0) + appliedSqm);
      newBatch.startOFR = round2(Number(newBatch.startOFR || 0) + appliedSqmOfr);
      newVariant.totalStart = round2(Number(newVariant.totalStart || 0) + appliedSqm);
      newVariant.totalStartOFR = round2(Number(newVariant.totalStartOFR || 0) + appliedSqmOfr);
      break;
  }

  // BALANCES (compute properly)
  const nbStart = Number(newBatch.start || 0);
  const nbIn = Number((newBatch as any).in || 0);
  const nbOut = Number((newBatch as any).out || 0);
  newBatch.balance = round2(nbStart + nbIn - nbOut);

  const nbStartO = Number((newBatch as any).startOFR || 0);
  const nbInO = Number((newBatch as any).inOFR || 0);
  const nbOutO = Number((newBatch as any).outOFR || 0);
  newBatch.balanceOFR = round2(nbStartO + nbInO - nbOutO);

  const nvStart = Number((newVariant as any).totalStart || 0);
  const nvIn = Number((newVariant as any).totalIn || 0);
  const nvOut = Number((newVariant as any).totalOut || 0);
  newVariant.totalBalance = round2(nvStart + nvIn - nvOut);

  const nvStartO = Number((newVariant as any).totalStartOFR || 0);
  const nvInO = Number((newVariant as any).totalInOFR || 0);
  const nvOutO = Number((newVariant as any).totalOutOFR || 0);
  newVariant.totalBalanceOFR = round2(nvStartO + nvInO - nvOutO);

  // Also refresh old batch/variant balances if batch changed
  const refreshBatchVariantBalances = (b: any, v: any) => {
    const bStart = Number(b.start || 0);
    const bIn = Number(b.in || 0);
    const bOut = Number(b.out || 0);
    b.balance = round2(bStart + bIn - bOut);

    const bStartO = Number(b.startOFR || 0);
    const bInO = Number(b.inOFR || 0);
    const bOutO = Number(b.outOFR || 0);
    b.balanceOFR = round2(bStartO + bInO - bOutO);

    const vStart = Number(v.totalStart || 0);
    const vIn = Number(v.totalIn || 0);
    const vOut = Number(v.totalOut || 0);
    v.totalBalance = round2(vStart + vIn - vOut);

    const vStartO = Number(v.totalStartOFR || 0);
    const vInO = Number(v.totalInOFR || 0);
    const vOutO = Number(v.totalOutOFR || 0);
    v.totalBalanceOFR = round2(vStartO + vInO - vOutO);
  };

  // Save everything
  await this.inventoryCountRepo.save(countRec);
  await this.inventoryTxnRepo.save(txn);

  if (newBatch.id !== oldBatch.id) {
    refreshBatchVariantBalances(oldBatch, oldVariant);

    await this.itemBatchRepo.save(newBatch);
    await this.itemVariantRepo.save(newVariant);

    await this.itemBatchRepo.save(oldBatch);
    await this.itemVariantRepo.save(oldVariant);
  } else {
    await this.itemBatchRepo.save(newBatch);
    await this.itemVariantRepo.save(newVariant);
  }

  return countRec;
}

async createSingleopening(data: any): Promise<InventoryCount> {
  const {
    itemVariantId,
    date,
    count,
    type,
    unit,
    countOFR = 0,
    finalCost = 0,
    finalCostOfr = 0,
    dateReceived: rawDateReceived = null, // 👈 new raw input
    condition = 'Clean', // 👈 default value
  } = data;

  // ✅ Format the dateReceived to MM/YYYY
  const formatDateReceived = (value: string | null): string | null => {
    if (!value) return null;
    const [month, year] = value.split('/');
    if (!month || !year) return null;
    return `${month.padStart(2, '0')}/${year}`;
  };

  const formattedDateReceived = formatDateReceived(rawDateReceived);

  // ✅ Step 1: Try to find existing batch
  let batch = await this.itemBatchRepo.findOne({
    where: {
      itemVariant: { id: itemVariantId },
      dateReceived: formattedDateReceived ? formattedDateReceived : IsNull(),
    },
    // 👇 ensure we have variant + its itemNameDescription for later
    relations: ['itemVariant', 'itemVariant.itemNameDescription'],
  });

  console.log(
    '✅ Batch search result:',
    batch?.id,
    'dateReceived:',
    batch?.dateReceived,
  );

  // ✅ Step 2: If no such batch, create one
  if (!batch) {
    const variantFound = await this.itemVariantRepo.findOne({
      where: { id: itemVariantId },
      relations: ['itemNameDescription'], // 👈 also load description here
    });
    if (!variantFound)
      throw new NotFoundException(`ItemVariant #${itemVariantId} not found`);

    batch = this.itemBatchRepo.create({
      itemVariant: variantFound,
      dateReceived: formattedDateReceived || null,
      condition: condition || 'Clean',
    });
    await this.itemBatchRepo.save(batch);

    // Attach variant manually
    batch.itemVariant = variantFound;
  }

  // this is the variant we will update (totals + costs)
  const variant = batch.itemVariant;

  // ✅ Step 3: Compute sqm
  const oneSheetM2 = (Number(variant.length) * Number(variant.width)) / 10000;
  let rawSqm = 0;
  let rawSqmofr = 0;

  switch (unit) {
    case 'box':
      rawSqm = oneSheetM2 * variant.sheetsPerBox * count;
      rawSqmofr =
        type === 'G'
          ? oneSheetM2 * variant.sheetsPerBox * count
          : oneSheetM2 * variant.sheetsPerBox * countOFR;
      break;

    case 'sheet':
      rawSqm = oneSheetM2 * count;
      rawSqmofr = type === 'G' ? oneSheetM2 * count : oneSheetM2 * countOFR;
      break;

    case 'sqm':
      rawSqm = count;
      rawSqmofr = type === 'G' ? count : countOFR;
      break;
  }

  const sqm = Number(rawSqm.toFixed(2));
  const sqmofr = Number(rawSqmofr.toFixed(2));

  // ✅ Step 4: Compute cost
  let fc = 0,
    fco = 0;
  if (type === 'S') {
    fc = finalCost;
    fco = finalCost;
  } else if (type === 'G') {
    fco = finalCostOfr;
  } else if (type === 'RVR') {
    fc = finalCost;
  } else if (type === 'SR') {
    fc = finalCost;
    fco = finalCostOfr;
  }

  // ⭐ Step 4.1 – push opening costs into ItemVariant (averageCost / averageCostVM)
  // finalCost      -> averageCost
  // finalCostOfr   -> averageCostVM
  // We only overwrite if a positive cost is provided.
  if (fc > 0) {
    variant.averageCostVM = Number(fco.toFixed(2));
  }
  if (fco > 0) {
    variant.averageCost = Number(fc.toFixed(2));
  }

  // ✅ Step 5: Save inventory count
const inventoryCount = this.inventoryCountRepo.create({
  itemVariant: variant,
  date,
  count,
  type,
  sqm,
  sqmOfr: sqmofr, // ✅ fill sqmOfr correctly
  finalCost: fc,
  finalCostOfr: fco,
});
  const savedCount = await this.inventoryCountRepo.save(inventoryCount);

  // ✅ Step 6: Save inventory transaction
  let qty = 0;
  let qtyOFR = 0;
  let txnSqm = 0;
  let txnSqmOFR = 0;

  switch (type) {
    case 'S':
      qty = count;
      qtyOFR = count;
      txnSqm = sqm;
      txnSqmOFR = sqm;
      break;

    case 'G':
      qty = 0;
      qtyOFR = count;
      txnSqm = 0;
      txnSqmOFR = sqmofr;
      break;

    case 'RVR':
      qty = count;
      qtyOFR = 0;
      txnSqm = sqm;
      txnSqmOFR = 0;

      // ⭐ NEW: when type = 'RVR', push finalCost into ItemNameDescription.averageCostCVM
      if (fc > 0 && variant.itemNameDescription) {
        variant.itemNameDescription.averageCostCVM = Number(fc.toFixed(2));
        await this.itemNameDescriptionRepo.save(variant.itemNameDescription);
      }
      break;

    case 'SR':
      qty = count;
      qtyOFR = countOFR;
      txnSqm = sqm;
      txnSqmOFR = sqmofr;
      break;
  }

  const txn = this.inventoryTxnRepo.create({
    itemVariant: variant,
    itemBatchId: batch.id,
    transactionType: 'Count',
    sqm: txnSqm,
    sqmofr: txnSqmOFR,
    quantity: qty,
    quantityofr: qtyOFR,
    inventoryCountId: savedCount.id,
    finalcost: fc,
    finalcostofr: fco,
    dateForEachInvoice: new Date(savedCount.date),
  });
  await this.inventoryTxnRepo.save(txn);

  // ✅ Step 7: Update batch and variant totals
  switch (type) {
    case 'RVR':
      batch.start = Number(batch.start) + sqm;
      variant.totalStart = Number(variant.totalStart) + sqm;
      batch.balance =
        Number(batch.start || 0) +
        Number(batch.in || 0) -
        Number(batch.out || 0);
      variant.totalBalance =
        Number(variant.totalStart || 0) +
        Number(variant.totalIn || 0) -
        Number(variant.totalOut || 0);
      break;

    case 'S':
      batch.start = Number(batch.start) + sqm;
      batch.startOFR = Number(batch.startOFR) + sqm;
      batch.balance =
        Number(batch.start || 0) +
        Number(batch.in || 0) -
        Number(batch.out || 0);
      batch.balanceOFR =
        Number(batch.startOFR || 0) +
        Number(batch.inOFR || 0) -
        Number(batch.outOFR || 0);
      variant.totalStart = Number(variant.totalStart) + sqm;
      variant.totalStartOFR = Number(variant.totalStartOFR) + sqm;

      variant.totalBalance =
        Number(variant.totalStart || 0) +
        Number(variant.totalIn || 0) -
        Number(variant.totalOut || 0);
      variant.totalBalanceOFR =
        Number(variant.totalStartOFR || 0) +
        Number(variant.totalInOFR || 0) -
        Number(variant.totalOutOFR || 0);
      break;

    case 'G':
      batch.startOFR = Number(batch.startOFR) + sqmofr;
      variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;

      batch.balanceOFR =
        Number(batch.startOFR || 0) +
        Number(batch.inOFR || 0) -
        Number(batch.outOFR || 0);

      variant.totalBalanceOFR =
        Number(variant.totalStartOFR || 0) +
        Number(variant.totalInOFR || 0) -
        Number(variant.totalOutOFR || 0);
      break;

    case 'SR':
      batch.start = Number(batch.start) + sqm;
      batch.startOFR = Number(batch.startOFR) + sqmofr;
      variant.totalStart = Number(variant.totalStart) + sqm;
      variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
      batch.balance =
        Number(batch.start || 0) +
        Number(batch.in || 0) -
        Number(batch.out || 0);
      batch.balanceOFR =
        Number(batch.startOFR || 0) +
        Number(batch.inOFR || 0) -
        Number(batch.outOFR || 0);
      variant.totalBalance =
        Number(variant.totalStart || 0) +
        Number(variant.totalIn || 0) -
        Number(variant.totalOut || 0);
      variant.totalBalanceOFR =
        Number(variant.totalStartOFR || 0) +
        Number(variant.totalInOFR || 0) -
        Number(variant.totalOutOFR || 0);
      break;
  }

  await this.itemBatchRepo.save(batch);
  await this.itemVariantRepo.save(variant);

  return savedCount;
}


  async createInventoryCheck(
    itemBatchId: number,
    itemType: 'box' | 'sheet' | 'sqm',
    length: number,
    width: number,
    sheetsPerBox: number,
    records: {
      count: number;
      receivedDate: string;
      status: 'adj+' | 'adj-' | 'breakage';
    }[],
  ): Promise<void> {
    const originalBatch = await this.itemBatchRepo.findOneOrFail({
      where: { id: itemBatchId },
      relations: ['itemVariant'],
    });

    const itemVariantId = originalBatch.itemVariant.id;
    const variant = originalBatch.itemVariant;

    const sqmPerUnit =
      itemType === 'sqm'
        ? 1
        : (length / 100) *
          (width / 100) *
          (itemType === 'box' ? sheetsPerBox : 1);

    console.log('\n🔎 Original Batch Found:', {
      id: originalBatch.id,
      itemVariantId,
      startOFR: originalBatch.startOFR,
      balanceOFR: originalBatch.balanceOFR,
      condition: originalBatch.condition,
    });

    for (const record of records) {
      const { count, receivedDate, status } = record;
      const totalSQM = count * sqmPerUnit;

      console.log('\n📦 Processing Record:', {
        count,
        receivedDate,
        status,
        totalSQM,
      });

      if (status === 'adj+') {
        let targetBatch = await this.itemBatchRepo.findOne({
          where: {
            itemVariant: { id: itemVariantId },
            dateReceived: receivedDate,
            condition: originalBatch.condition,
          },
        });

        if (!targetBatch) {
          targetBatch = this.itemBatchRepo.create({
            itemVariant: { id: itemVariantId },
            dateReceived: receivedDate,
            condition: originalBatch.condition,
            startOFR: 0,
            balanceOFR: 0,
          });
          await this.itemBatchRepo.save(targetBatch);
          console.log('🆕 Created new target batch:', targetBatch);
        } else {
          console.log('✅ Found existing target batch:', {
            id: targetBatch.id,
            startOFR: targetBatch.startOFR,
            balanceOFR: targetBatch.balanceOFR,
          });
        }

        // ✅ Deduct from original
        originalBatch.startOFR = Number(originalBatch.startOFR) - totalSQM;
        originalBatch.balanceOFR = Number(originalBatch.balanceOFR) - totalSQM;

        // ✅ Add to target
        targetBatch.startOFR = Number(targetBatch.startOFR) + totalSQM;
        targetBatch.balanceOFR = Number(targetBatch.balanceOFR) + totalSQM;

        console.log('📉 Deducting from original batch:', {
          id: originalBatch.id,
          deductedSQM: totalSQM,
        });
        console.log('📈 Adding to target batch:', {
          id: targetBatch.id,
          addedSQM: totalSQM,
        });

        await this.itemBatchRepo.save([originalBatch, targetBatch]);

        await this.inventoryTxnRepo.save([
          this.inventoryTxnRepo.create({
            transactionType: 'adjustment -',
            quantity: 0,
            quantityofr: -count,
            sqmofr: -totalSQM,
            sqm: 0,
            itemBatchId: originalBatch.id,
            itemVariantId,
            dateForEachInvoice: new Date(record.receivedDate),
          }),
          this.inventoryTxnRepo.create({
            transactionType: 'adjustment +',
            quantity: 0,
            quantityofr: count,
            sqmofr: totalSQM,
            sqm: 0,
            itemBatchId: targetBatch.id,
            itemVariantId,
            dateForEachInvoice: new Date(record.receivedDate),
          }),
        ]);
      } else if (status === 'breakage') {
        // ✅ Deduct from batch
        originalBatch.startOFR = Number(originalBatch.startOFR) - totalSQM;
        originalBatch.balanceOFR = Number(originalBatch.balanceOFR) - totalSQM;

        // ✅ Deduct from variant (breakage only)
        variant.totalStartOFR = Number(variant.totalStartOFR) - totalSQM;
        variant.totalBalanceOFR = Number(variant.totalBalanceOFR) - totalSQM;

        console.log(`📉 Deducting (breakage) from batch and variant:`, {
          batchId: originalBatch.id,
          deductedSQM: totalSQM,
          variantId: variant.id,
        });

        await this.itemBatchRepo.save(originalBatch);
        await this.itemVariantRepo.save(variant);

        await this.inventoryTxnRepo.save(
          this.inventoryTxnRepo.create({
            transactionType: status,
            quantity: 0,
            quantityofr: -count,
            sqmofr: -totalSQM,
            sqm: 0,
            itemBatchId: originalBatch.id,
            itemVariantId,
            dateForEachInvoice: new Date(record.receivedDate),
          }),
        );
      } else {
        // ✅ For adj- → deduct from batch only
        originalBatch.startOFR = Number(originalBatch.startOFR) - totalSQM;
        originalBatch.balanceOFR = Number(originalBatch.balanceOFR) - totalSQM;

        console.log(`📉 Deducting (${status}) from original batch:`, {
          id: originalBatch.id,
          deductedSQM: totalSQM,
        });

        await this.itemBatchRepo.save(originalBatch);

        await this.inventoryTxnRepo.save(
          this.inventoryTxnRepo.create({
            transactionType: status,
            quantity: 0,
            quantityofr: -count,
            sqmofr: -totalSQM,
            sqm: 0,
            itemBatchId: originalBatch.id,
            itemVariantId,
            dateForEachInvoice: new Date(receivedDate),
          }),
        );
      }
    }

    console.log('\n✅ Inventory check completed.');
  }








  // operation 29-11-2025 


    private round2(n: any) {
    return Number((Number(n || 0)).toFixed(2));
  }

  /**
   * Rebuild Opening Counts so that only keepDate remains.
   * - Deletes Opening Count txns for BOTH dates (keepDate + deleteDate)
   * - Deletes counts on deleteDate
   * - Resets & recomputes batch/variant openings from keepDate counts
   * - Reinserts Opening Count txns only for keepDate counts
   */
async rebuildOpeningCountsKeepDate(params: {
  keepDate: string;      // e.g. '2025-11-29'
  deleteDate: string;    // e.g. '2025-10-31'
}) {
  const keepDate = String(params.keepDate || '').slice(0, 10);
  const deleteDate = String(params.deleteDate || '').slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(keepDate) || !/^\d{4}-\d{2}-\d{2}$/.test(deleteDate)) {
    throw new BadRequestException('keepDate/deleteDate must be YYYY-MM-DD');
  }
  if (keepDate === deleteDate) {
    throw new BadRequestException('keepDate and deleteDate cannot be the same');
  }

  const toUtcMidnight = (d: string) => new Date(`${d}T00:00:00.000Z`);

  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();

  try {
    // 1) load counts for both dates
    const keepCounts = await qr.manager.find(InventoryCount, {
      where: { date: keepDate as any },
    });
    const deleteCounts = await qr.manager.find(InventoryCount, {
      where: { date: deleteDate as any },
    });

    if (!deleteCounts.length) {
      throw new NotFoundException(`No counts found on deleteDate ${deleteDate}`);
    }
    if (!keepCounts.length) {
      throw new NotFoundException(`No counts found on keepDate ${keepDate}`);
    }

    const keepIds = keepCounts.map((c) => c.id);
    const deleteIds = deleteCounts.map((c) => c.id);

    const affectedVariantIds = Array.from(
      new Set(
        [...keepCounts, ...deleteCounts]
          .map((c: any) => c.itemVariantId)
          .filter(Boolean),
      ),
    );

    if (!affectedVariantIds.length) {
      throw new BadRequestException('No affected variants found.');
    }

    // 2) fetch variants
    const variants = await qr.manager.findBy(ItemVariant, { id: In(affectedVariantIds) });
    const variantMap = new Map<number, ItemVariant>(variants.map((v) => [v.id, v]));

    // 3) fetch OR CREATE the required NULL-dateReceived batch per affected variant
    const nullDateBatches = await qr.manager.find(ItemBatch, {
      where: {
        itemVariant: { id: In(affectedVariantIds) } as any,
        dateReceived: IsNull(),
      },
      relations: ['itemVariant'],
    });

    const batchMap = new Map<number, ItemBatch>();
    for (const b of nullDateBatches) {
      const vid = b.itemVariant?.id;
      if (!vid) continue;

      if (batchMap.has(vid)) {
        throw new BadRequestException(
          `Variant #${vid} has more than one NULL-dateReceived batch. Stop to avoid wrong batch updates.`,
        );
      }

      // force condition = Clean (your business rule)
      if ((b.condition ?? '') !== 'Clean') b.condition = 'Clean';
      batchMap.set(vid, b);
    }

    // create missing batches
    const createdBatches: ItemBatch[] = [];
    for (const vid of affectedVariantIds) {
      if (batchMap.has(vid)) continue;

      const v = variantMap.get(vid);
      if (!v) throw new BadRequestException(`Variant #${vid} not loaded while creating batch.`);

      const newBatch = qr.manager.create(ItemBatch, {
        itemVariant: v,
        condition: 'Clean',
        dateReceived: null,

        start: 0,
        in: 0,
        out: 0,
        balance: 0,
        startOFR: 0,
        inOFR: 0,
        outOFR: 0,
        balanceOFR: 0,
      });

      createdBatches.push(newBatch);
      batchMap.set(vid, newBatch);
    }

    if (createdBatches.length) await qr.manager.save(ItemBatch, createdBatches);
    await qr.manager.save(ItemBatch, Array.from(batchMap.values())); // persist condition fixes too

    // 4) delete Opening Count txns linked to counts (both dates)
    await qr.manager
      .createQueryBuilder()
      .delete()
      .from(InventoryTransaction)
      .where('transactionType = :tt', { tt: 'Count' })
      .andWhere('inventoryCountId IN (:...ids)', { ids: [...keepIds, ...deleteIds] })
      .execute();

    // 5) reset openings for affected batches/variants
    for (const vid of affectedVariantIds) {
      const v = variantMap.get(vid);
      const b = batchMap.get(vid);
      if (!v || !b) continue;

      b.start = 0 as any;
      b.startOFR = 0 as any;

      v.totalStart = 0 as any;
      v.totalStartOFR = 0 as any;
    }

    // 6) build sums ONLY from keepDate counts
    const sums = new Map<number, { start: number; startOfr: number }>();
    const add = (vid: number, ds: number, dofr: number) => {
      const cur = sums.get(vid) ?? { start: 0, startOfr: 0 };
      cur.start = this.round2(cur.start + ds);
      cur.startOfr = this.round2(cur.startOfr + dofr);
      sums.set(vid, cur);
    };

    for (const c of keepCounts as any[]) {
      const vid = c.itemVariantId;
      const sqm = this.round2(c.sqm);
      const sqmOfr = this.round2(c.sqmOfr ?? 0);

      switch (c.type as CountType) {
        case CountType.S:
          add(vid, sqm, sqm);
          break;
        case CountType.G:
          add(vid, 0, sqmOfr || sqm);
          break;
        case CountType.SR:
          add(vid, sqm, sqmOfr || sqm);
          break;
        case CountType.RVR:
          add(vid, sqm, 0);
          break;
      }
    }

    // ✅ CHANGED RULE:
    // Any affected variant that does NOT exist in keepDate sums keeps opening = 0.
    // We STILL recompute its balances using existing in/out totals.

    const zeroedVariants: number[] = [];

    for (const vid of affectedVariantIds) {
      const v = variantMap.get(vid);
      const b = batchMap.get(vid);
      if (!v || !b) continue;

      const s = sums.get(vid) ?? { start: 0, startOfr: 0 };
      if (!sums.has(vid)) zeroedVariants.push(vid);

      b.start = this.round2(s.start) as any;
      b.startOFR = this.round2(s.startOfr) as any;

      b.balance = this.round2(
        Number(b.start || 0) + Number((b as any).in || 0) - Number((b as any).out || 0),
      ) as any;

      b.balanceOFR = this.round2(
        Number(b.startOFR || 0) + Number((b as any).inOFR || 0) - Number((b as any).outOFR || 0),
      ) as any;

      v.totalStart = this.round2(s.start) as any;
      v.totalStartOFR = this.round2(s.startOfr) as any;

      v.totalBalance = this.round2(
        Number((v as any).totalStart || 0) + Number((v as any).totalIn || 0) - Number((v as any).totalOut || 0),
      ) as any;

      v.totalBalanceOFR = this.round2(
        Number((v as any).totalStartOFR || 0) + Number((v as any).totalInOFR || 0) - Number((v as any).totalOutOFR || 0),
      ) as any;
    }

    await qr.manager.save(ItemBatch, Array.from(batchMap.values()));
    await qr.manager.save(ItemVariant, variants);

    // 7) delete counts on deleteDate
    await qr.manager.delete(InventoryCount, { date: deleteDate as any });

    // 8) reinsert Opening Count txns ONLY for keepDate counts
    const newTxns: Partial<InventoryTransaction>[] = [];

    for (const c of keepCounts as any[]) {
      const vid = c.itemVariantId;
      const v = variantMap.get(vid)!;
      const b = batchMap.get(vid)!;

      const sqm = this.round2(c.sqm);
      const sqmOfr = this.round2(c.sqmOfr ?? 0);
      const type = c.type as CountType;

      let txnSqm = 0, txnSqmOfr = 0, qty = 0, qtyOfr = 0;

      if (type === CountType.S) {
        txnSqm = sqm; txnSqmOfr = sqm;
        qty = c.count; qtyOfr = c.count;
      } else if (type === CountType.G) {
        txnSqm = 0; txnSqmOfr = sqmOfr || sqm;
        qty = 0; qtyOfr = c.count;
      } else if (type === CountType.RVR) {
        txnSqm = sqm; txnSqmOfr = 0;
        qty = c.count; qtyOfr = 0;
      } else if (type === CountType.SR) {
        txnSqm = sqm; txnSqmOfr = sqmOfr || sqm;
        qty = c.count;
        qtyOfr = c.countOFR ?? c.count; // entity doesn’t store countOFR -> fallback
      }

      newTxns.push({
        transactionType: 'Count',
        itemVariantId: v.id,
        itemBatchId: b.id,
        inventoryCountId: c.id,

        sqm: this.round2(txnSqm) as any,
        sqmofr: this.round2(txnSqmOfr) as any,
        quantity: qty as any,
        quantityofr: qtyOfr as any,

        finalcost: this.round2(c.finalCost ?? 0) as any,
        finalcostofr: this.round2(c.finalCostOfr ?? 0) as any,

        dateForEachInvoice: toUtcMidnight(keepDate),
        transactionDate: toUtcMidnight(keepDate),
      });
    }

    await qr.manager.save(InventoryTransaction, newTxns);

    await qr.commitTransaction();
    return {
      ok: true,
      deletedCounts: deleteCounts.length,
      keptCounts: keepCounts.length,
      affectedVariants: affectedVariantIds.length,
      createdNullDateBatches: createdBatches.length,
      insertedOpeningTxns: newTxns.length,
      // ✅ new info to help you verify
      zeroedVariantsCount: zeroedVariants.length,
      zeroedVariantsSample: zeroedVariants.slice(0, 25),
    };
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
}



// In InventoryCountService

async deleteCountsStrictRecomputeFromCounts(params: { ids: number[] }) {
  console.log('🧨 deleteCountsStrictRecomputeFromCounts IN:', params);

  const ids = Array.from(
    new Set(
      (params.ids || [])
        .map((x) => Number(x))
        .filter((x) => Number.isInteger(x) && x > 0),
    ),
  );

  console.log('🧾 normalized ids:', ids);

  if (!ids.length) {
    throw new BadRequestException('ids must be a non-empty array of positive integers');
  }

  const round2 = (n: any) => Number((Number(n || 0)).toFixed(2));

  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();

  try {
    // 0) show which DB we’re connected to
    const dbRow = await qr.query(`SELECT DATABASE() AS db`);
    console.log('🗄️ Connected DB:', dbRow?.[0]?.db);

    const ph = ids.map(() => '?').join(',');

    // 1) Load counts (NO itemBatch relation exists on InventoryCount)
    const counts: InventoryCount[] = await qr.manager.find(InventoryCount, {
      where: { id: In(ids) } as any,
      relations: ['itemVariant'] as any, // ok
    });

    console.log('✅ counts loaded:', counts.map((c) => c.id));

    if (counts.length !== ids.length) {
      const found = new Set(counts.map((c) => Number(c.id)));
      const missingCounts = ids.filter((id) => !found.has(id));
      console.error('❌ Missing InventoryCount ids:', missingCounts);
      throw new NotFoundException(`InventoryCount not found for ids: ${missingCounts.join(', ')}`);
    }

    // 2) STRICT: each count must have at least one txn where txn.inventoryCountId = count.id
    const txnAgg: any[] = await qr.query(
      `
      SELECT inventoryCountId, COUNT(*) AS cnt
      FROM inventory_transaction
      WHERE inventoryCountId IN (${ph})
      GROUP BY inventoryCountId
      `,
      ids,
    );

    console.log('📌 txnAgg:', txnAgg);

    const present = new Set(
      txnAgg
        .map((r) => Number(r.inventoryCountId))
        .filter((n) => Number.isFinite(n) && n > 0),
    );

    const missingTxnIds = ids.filter((cid) => !present.has(cid));
    console.log('🔎 present txn countIds:', Array.from(present.values()));
    console.log('❓ missingTxnIds:', missingTxnIds);

    if (missingTxnIds.length) {
      // extra debug: show latest txns around these ids
      const mph = missingTxnIds.map(() => '?').join(',');
      const sample = await qr.query(
        `
        SELECT id, inventoryCountId, itemVariantId, itemBatchId, transactionType, sqm, sqmofr, dateForEachInvoice
        FROM inventory_transaction
        WHERE inventoryCountId IN (${mph})
        ORDER BY id DESC
        LIMIT 50
        `,
        missingTxnIds,
      );
      console.log('🧪 txns found for missingTxnIds sample:', sample);

      throw new BadRequestException(
        `Cannot delete counts: related InventoryTransaction is missing for count ids: ${missingTxnIds.join(', ')}`,
      );
    }

    // 3) Derive affected batchIds + variantIds from transactions (this is the correct source)
    const countToBatch: any[] = await qr.query(
      `
      SELECT
        inventoryCountId,
        MIN(itemBatchId)  AS itemBatchId,
        MIN(itemVariantId) AS itemVariantId,
        COUNT(DISTINCT itemBatchId) AS batchesForSameCount
      FROM inventory_transaction
      WHERE inventoryCountId IN (${ph})
      GROUP BY inventoryCountId
      `,
      ids,
    );

    console.log('🧩 countToBatch mapping:', countToBatch);

    const multiBatchCounts = countToBatch.filter((r) => Number(r.batchesForSameCount) > 1);
    if (multiBatchCounts.length) {
      console.warn('⚠️ Some counts have txns pointing to multiple batches:', multiBatchCounts);
    }

    const affectedBatchIds = Array.from(
      new Set(
        countToBatch
          .map((r) => Number(r.itemBatchId))
          .filter((x) => Number.isInteger(x) && x > 0),
      ),
    );

    const affectedVariantIds = Array.from(
      new Set(
        countToBatch
          .map((r) => Number(r.itemVariantId))
          .filter((x) => Number.isInteger(x) && x > 0),
      ),
    );

    console.log('📦 affectedBatchIds:', affectedBatchIds);
    console.log('🧱 affectedVariantIds:', affectedVariantIds);

    // 4) Delete txns first, then delete counts
    const delTxnRes = await qr.query(
      `DELETE FROM inventory_transaction WHERE inventoryCountId IN (${ph})`,
      ids,
    );
    console.log('🗑️ Deleted txns:', delTxnRes);

    const delCountRes = await qr.query(
      `DELETE FROM inventory_count WHERE id IN (${ph})`,
      ids,
    );
    console.log('🗑️ Deleted counts:', delCountRes);

    // 5) Recompute batch.start/startOFR from REMAINING counts (via txn->count mapping)
    if (affectedBatchIds.length) {
      const bph = affectedBatchIds.map(() => '?').join(',');

      const batchSums: any[] = await qr.query(
        `
        SELECT
          m.itemBatchId AS itemBatchId,
          COALESCE(SUM(
            CASE
              WHEN ic.type IN ('S','SR','RVR') THEN ic.sqm
              ELSE 0
            END
          ),0) AS sumStart,
          COALESCE(SUM(
            CASE
              WHEN ic.type = 'S'  THEN ic.sqm
              WHEN ic.type = 'G'  THEN COALESCE(ic.sqmOfr, ic.sqm, 0)
              WHEN ic.type = 'SR' THEN COALESCE(ic.sqmOfr, ic.sqm, 0)
              ELSE 0
            END
          ),0) AS sumStartOfr
        FROM inventory_count ic
        JOIN (
          SELECT inventoryCountId, MIN(itemBatchId) AS itemBatchId
          FROM inventory_transaction
          WHERE inventoryCountId IS NOT NULL
            AND transactionType IN ('Count','Count')
          GROUP BY inventoryCountId
        ) m ON m.inventoryCountId = ic.id
        WHERE m.itemBatchId IN (${bph})
        GROUP BY m.itemBatchId
        `,
        affectedBatchIds,
      );

      console.log('📊 batchSums:', batchSums);

      const batchMap = new Map<number, { start: number; startOfr: number }>();
      for (const r of batchSums) {
        batchMap.set(Number(r.itemBatchId), {
          start: round2(r.sumStart),
          startOfr: round2(r.sumStartOfr),
        });
      }

      const batches: any[] = await qr.manager.findBy(ItemBatch, { id: In(affectedBatchIds) } as any);
      console.log('📦 loaded batches:', batches.map((b) => b.id));

      for (const b of batches) {
        const bid = Number(b.id);
        const s = batchMap.get(bid) ?? { start: 0, startOfr: 0 };

        const before = {
          id: bid,
          start: Number(b.start || 0),
          startOFR: Number((b as any).startOFR || 0),
          balance: Number((b as any).balance || 0),
          balanceOFR: Number((b as any).balanceOFR || 0),
        };

        b.start = round2(s.start);
        (b as any).startOFR = round2(s.startOfr);

        (b as any).balance = round2(
          Number(b.start || 0) + Number((b as any).in || 0) - Number((b as any).out || 0),
        );
        (b as any).balanceOFR = round2(
          Number((b as any).startOFR || 0) +
            Number((b as any).inOFR || 0) -
            Number((b as any).outOFR || 0),
        );

        console.log('🧮 batch recompute', { before, computed: s, after: {
          id: bid,
          start: Number(b.start || 0),
          startOFR: Number((b as any).startOFR || 0),
          balance: Number((b as any).balance || 0),
          balanceOFR: Number((b as any).balanceOFR || 0),
        }});
      }

      await qr.manager.save(ItemBatch, batches);
      console.log('✅ batches saved');
    }

    // 6) Recompute variant totals from batches
    if (affectedVariantIds.length) {
      const variantSums = await qr.manager
        .createQueryBuilder(ItemBatch, 'b')
        .select('b.itemVariantId', 'itemVariantId')
        .addSelect('COALESCE(SUM(b.start),0)', 'sumTotalStart')
        .addSelect('COALESCE(SUM(b.startOFR),0)', 'sumTotalStartOfr')
        .where('b.itemVariantId IN (:...vids)', { vids: affectedVariantIds })
        .groupBy('b.itemVariantId')
        .getRawMany();

      console.log('📊 variantSums:', variantSums);

      const vMap = new Map<number, { ts: number; tso: number }>();
      for (const r of variantSums as any[]) {
        vMap.set(Number(r.itemVariantId), {
          ts: round2(r.sumTotalStart),
          tso: round2(r.sumTotalStartOfr),
        });
      }

      const variants: any[] = await qr.manager.findBy(ItemVariant, { id: In(affectedVariantIds) } as any);
      console.log('🧱 loaded variants:', variants.map((v) => v.id));

      for (const v of variants) {
        const vid = Number(v.id);
        const s = vMap.get(vid) ?? { ts: 0, tso: 0 };

        const before = {
          id: vid,
          totalStart: Number((v as any).totalStart || 0),
          totalStartOFR: Number((v as any).totalStartOFR || 0),
        };

        (v as any).totalStart = round2(s.ts);
        (v as any).totalStartOFR = round2(s.tso);

        (v as any).totalBalance = round2(
          Number((v as any).totalStart || 0) +
            Number((v as any).totalIn || 0) -
            Number((v as any).totalOut || 0),
        );
        (v as any).totalBalanceOFR = round2(
          Number((v as any).totalStartOFR || 0) +
            Number((v as any).totalInOFR || 0) -
            Number((v as any).totalOutOFR || 0),
        );

        console.log('🧮 variant recompute', { before, computed: s, after: {
          id: vid,
          totalStart: Number((v as any).totalStart || 0),
          totalStartOFR: Number((v as any).totalStartOFR || 0),
        }});
      }

      await qr.manager.save(ItemVariant, variants);
      console.log('✅ variants saved');
    }

    await qr.commitTransaction();
    console.log('✅ COMMIT OK');

    return {
      ok: true,
      deletedCountIds: ids,
      affectedBatchIds,
      affectedVariantIds,
    };
  } catch (e) {
    console.error('🧨 ERROR -> rollback:', (e as any)?.message || e);
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
    console.log('🧹 released queryRunner');
  }
}





async createOpeningSnapshotG(params: {
  asOf: string; // 'YYYY-MM-DD'
  deleteExisting?: boolean; // default true
  skipZeroRows?: boolean; // default true
}) {
  const asOf = params.asOf;
  const deleteExisting = params.deleteExisting ?? true;
  const skipZeroRows = params.skipZeroRows ?? true;

  // Basic date validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new BadRequestException(`asOf must be YYYY-MM-DD (got "${asOf}")`);
  }

  // 0) Delete existing opening counts for that date/type (safe rerun)
  if (deleteExisting) {
    const existing = await this.inventoryCountRepo.find({
      where: { date: asOf as any, type: CountType.G },
      select: ['id'],
    });

    const ids = existing.map((x: any) => x.id);
    if (ids.length) {
      // delete linked txns first (safe even if FK cascade exists)
      await this.inventoryTxnRepo.delete({ inventoryCountId: In(ids) });
      await this.inventoryCountRepo.delete({ id: In(ids) });
    }
  }

  // 1) Snapshot per batch+variant from InventoryTransaction up to date (inclusive)
  // qty snapshot for G = SUM(quantityofr)
  // sqm snapshot for G = SUM(sqmofr)
  const snapshotRows = await this.inventoryTxnRepo
    .createQueryBuilder('t')
    .select('t.itemBatchId', 'itemBatchId')
    .addSelect('t.itemVariantId', 'itemVariantId')
    .addSelect('SUM(COALESCE(t.quantityofr, 0))', 'qtyOfr')
    .addSelect('SUM(COALESCE(t.sqmofr, 0))', 'sqmOfr')
    .where(`DATE(COALESCE(t.dateForEachInvoice, t.transactionDate)) <= :asOf`, {
      asOf,
    })
    .andWhere('t.itemBatchId IS NOT NULL')
    .groupBy('t.itemBatchId')
    .addGroupBy('t.itemVariantId')
    .getRawMany();

  // 2) Build cost map (Average Cost, NOT VM) as-of the date
  // Priority:
  //   A) latest PurchaseInvoiceItem.averageCost where PurchaseInvoice.date <= asOf
  //   B) if no purchases: earliest InventoryCount.finalCostOfr for that variant (MIN(date))
  //   C) fallback: ItemVariant.averageCost

  // A) Latest purchase averageCost per variant (deterministic) — MySQL 8+ window function
  const purchaseCostRows = await this.purchaseInvoiceItemRepo.query(
    `
    SELECT itemVariantId, averageCost AS avgCost
    FROM (
      SELECT
        pii.itemVariantId,
        pii.averageCost,
        ROW_NUMBER() OVER (
          PARTITION BY pii.itemVariantId
          ORDER BY pi.date DESC, pii.id DESC
        ) AS rn
      FROM purchase_invoice_items pii
      INNER JOIN purchase_invoices pi ON pi.id = pii.invoiceId
      WHERE pi.date <= ?
    ) x
    WHERE x.rn = 1
    `,
    [asOf],
  );

  const purchaseCostByVariant = new Map<number, number>();
  for (const r of purchaseCostRows) {
    purchaseCostByVariant.set(Number(r.itemVariantId), Number(r.avgCost || 0));
  }

  // B) Earliest count finalCostOfr per variant (for variants with no purchases)
  const countCostRows = await this.inventoryCountRepo.query(
    `
    SELECT ic.itemVariantId, ic.finalCostOfr AS avgCost
    FROM inventory_count ic
    INNER JOIN (
      SELECT itemVariantId, MIN(date) AS minDate
      FROM inventory_count
      WHERE finalCostOfr > 0
      GROUP BY itemVariantId
    ) m ON m.itemVariantId = ic.itemVariantId AND m.minDate = ic.date
    INNER JOIN (
      SELECT itemVariantId, date, MAX(id) AS maxId
      FROM inventory_count
      WHERE finalCostOfr > 0
      GROUP BY itemVariantId, date
    ) pick ON pick.itemVariantId = ic.itemVariantId AND pick.date = ic.date AND pick.maxId = ic.id
    `,
  );

  const firstCountCostByVariant = new Map<number, number>();
  for (const r of countCostRows) {
    firstCountCostByVariant.set(Number(r.itemVariantId), Number(r.avgCost || 0));
  }

  // C) fallback: ItemVariant.averageCost
  const variants = await this.itemVariantRepo.find({
    select: ['id', 'averageCost'],
  });

  const fallbackAvgCost = new Map<number, number>();
  for (const v of variants) {
    fallbackAvgCost.set(Number(v.id), Number((v as any).averageCost || 0));
  }

  const resolveAvgCost = (itemVariantId: number) => {
    const a = purchaseCostByVariant.get(itemVariantId) ?? 0;
    if (a > 0) return a;

    const b = firstCountCostByVariant.get(itemVariantId) ?? 0;
    if (b > 0) return b;

    return fallbackAvgCost.get(itemVariantId) ?? 0;
  };

  // 3) Convert snapshot rows to payload rows for your create()
  // unit='sqm' => sqmofr = countOFR (exact snapshot sqmofr)
  // IMPORTANT: InventoryCount.count is int => if qtyOfr has decimals, we CANNOT represent it.
  const fractionalQty: Array<{
    itemBatchId: number;
    itemVariantId: number;
    qtyOfr: number;
  }> = [];

  const payloadRows = snapshotRows
    .map((r: any) => {
      const itemBatchId = Number(r.itemBatchId);
      const itemVariantId = Number(r.itemVariantId);
      const qtyOfr = Number(r.qtyOfr || 0);
      const sqmOfr = Number(r.sqmOfr || 0);

      if (!Number.isFinite(itemBatchId) || !Number.isFinite(itemVariantId))
        return null;

      if (skipZeroRows && qtyOfr === 0 && sqmOfr === 0) return null;

      // check fraction
      const frac = Math.abs(qtyOfr - Math.round(qtyOfr));
      if (frac > 0.0001) {
        fractionalQty.push({ itemBatchId, itemVariantId, qtyOfr });
      }

      const avgCost = resolveAvgCost(itemVariantId);

      return {
        itemBatchId,
        date: asOf,
        type: CountType.G,
        unit: 'sqm',

        // ✅ For G: qty snapshot comes from SUM(quantityofr)
        count: Math.round(qtyOfr),

        // ✅ For unit='sqm': sqmofr = countOFR (exact snapshot sqmofr)
        countOFR: Number(sqmOfr.toFixed(2)),

        finalCost: 0,

        // ✅ finalCostOfr should equal average cost (NOT VM)
        finalCostOfr: Number((avgCost || 0).toFixed(2)),
      };
    })
    .filter((x): x is any => !!x);

  if (fractionalQty.length) {
    const sample = fractionalQty.slice(0, 20);
    throw new BadRequestException(
      `Opening snapshot has fractional quantityofr values but InventoryCount.count is INT. ` +
        `Fix the data or change schema. Sample: ` +
        sample
          .map(
            (x) =>
              `batch ${x.itemBatchId}, variant ${x.itemVariantId}, qtyOfr=${x.qtyOfr}`,
          )
          .join(' | '),
    );
  }

  if (!payloadRows.length) {
    return {
      ok: true,
      asOf,
      created: 0,
      message: 'No rows to create (all snapshot rows are zero or none matched).',
    };
  }

  // 4) Create using YOUR existing create() => will create inventory_count + inventory_transaction rows
  const created = await this.create(payloadRows);

  // 5) Verify that every created InventoryCount has an InventoryTransaction row
  const createdArr = Array.isArray(created) ? created : [created];
  const createdIds = createdArr.map((c: any) => Number(c.id)).filter(Boolean);

  if (createdIds.length) {
    const txns = await this.inventoryTxnRepo.find({
      where: { inventoryCountId: In(createdIds) },
      select: ['inventoryCountId'],
    });

    const txnSet = new Set(txns.map((t: any) => Number(t.inventoryCountId)));
    const missingTxnIds = createdIds.filter((id) => !txnSet.has(id));

    if (missingTxnIds.length) {
      throw new BadRequestException(
        `Some InventoryCounts were created without InventoryTransaction rows. Missing for count IDs: ${missingTxnIds
          .slice(0, 50)
          .join(', ')}${missingTxnIds.length > 50 ? ' ...' : ''}`,
      );
    }
  }

  return {
    ok: true,
    asOf,
    created: createdArr.length,
    verifiedTransactions: true,
  };
}



async auditCountTransactions(params: {
    asOf?: string;           // filter by count.date = asOf
    type?: CountType;        // filter by count.type
    limit?: number;          // cap returned rows
  }) {
    const { asOf, type } = params;
    const limit = Math.min(Math.max(Number(params.limit ?? 500), 1), 5000);

    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new BadRequestException(`asOf must be YYYY-MM-DD (got "${asOf}")`);
    }

    const whereParts: string[] = [];
    const args: any[] = [];

    if (asOf) {
      whereParts.push(`c.date = ?`);
      args.push(asOf);
    }
    if (type) {
      whereParts.push(`c.type = ?`);
      args.push(type);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    // Total counts in scope
    const totalRes = await this.inventoryCountRepo.query(
      `SELECT COUNT(*) AS totalCounts
       FROM inventory_count c
       ${whereSql}`,
      args,
    );
    const totalCounts = Number(totalRes?.[0]?.totalCounts || 0);

    // Missing "Count" transactions (0 rows)
    const missing = await this.inventoryCountRepo.query(
      `
      SELECT
        c.id,
        c.itemVariantId,
        c.date,
        c.type
      FROM inventory_count c
      LEFT JOIN inventory_transaction t
        ON t.inventoryCountId = c.id
       AND t.transactionType = 'Count'
      ${whereSql}
      GROUP BY c.id, c.itemVariantId, c.date, c.type
      HAVING COUNT(t.id) = 0
      ORDER BY c.id ASC
      LIMIT ${limit}
      `,
      args,
    );

    // Duplicate "Count" transactions (>1 rows)
    const duplicates = await this.inventoryCountRepo.query(
      `
      SELECT
        c.id,
        c.itemVariantId,
        c.date,
        c.type,
        COUNT(t.id) AS txnCount
      FROM inventory_count c
      LEFT JOIN inventory_transaction t
        ON t.inventoryCountId = c.id
       AND t.transactionType = 'Count'
      ${whereSql}
      GROUP BY c.id, c.itemVariantId, c.date, c.type
      HAVING COUNT(t.id) > 1
      ORDER BY txnCount DESC, c.id ASC
      LIMIT ${limit}
      `,
      args,
    );

    // Counts that have transactions linked but none of them are transactionType='Count'
    // (rare, but useful to detect)
    const wrongType = await this.inventoryCountRepo.query(
      `
      SELECT
        c.id,
        c.itemVariantId,
        c.date,
        c.type,
        COUNT(tAll.id) AS totalLinkedTxns,
        SUM(CASE WHEN tAll.transactionType = 'Count' THEN 1 ELSE 0 END) AS countTypeTxns
      FROM inventory_count c
      LEFT JOIN inventory_transaction tAll
        ON tAll.inventoryCountId = c.id
      ${whereSql}
      GROUP BY c.id, c.itemVariantId, c.date, c.type
      HAVING COUNT(tAll.id) > 0 AND SUM(CASE WHEN tAll.transactionType = 'Count' THEN 1 ELSE 0 END) = 0
      ORDER BY c.id ASC
      LIMIT ${limit}
      `,
      args,
    );

    const missingCount = Array.isArray(missing) ? missing.length : 0;
    const duplicateCount = Array.isArray(duplicates) ? duplicates.length : 0;
    const wrongTypeCount = Array.isArray(wrongType) ? wrongType.length : 0;

    return {
      ok: missingCount === 0 && duplicateCount === 0 && wrongTypeCount === 0,
      scope: { asOf: asOf ?? null, type: type ?? null },
      totals: {
        totalCounts,
        missingCount,
        duplicateCount,
        wrongTypeCount,
        limit,
      },
      missing,      // list of count rows with 0 Count-transactions
      duplicates,   // list with txnCount > 1
      wrongType,    // list where linked txns exist but none are type='Count'
    };
  }


}