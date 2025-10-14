import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from '../entities/inventory/item.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';



type SearchModalQuery = {
  q: string;
  dims?: string;                       // optional "225*321-012"
  length?: number;
  width?: number;
  spb?: number;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  page: number;
  limit: number;
};
@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private readonly itemRepository: Repository<Item>,
    @InjectRepository(Thickness)
    private readonly thicknessRepository: Repository<Thickness>,
    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,

    @InjectRepository(ItemNameDescription)
    private readonly itemNameDescriptionRepository: Repository<ItemNameDescription>,
  ) {}

  // CRUD for Items
  async createItem(createItemDto: Partial<Item>): Promise<Item> {
    const item = this.itemRepository.create(createItemDto);
    return await this.itemRepository.save(item);
  }

  async getAllItems(): Promise<Item[]> {
    return await this.itemRepository.find({ relations: ['thicknesses'] });
  }

  async getItemById(id: number): Promise<Item> {
    return await this.itemRepository.findOne({
      where: { id },
      relations: ['thicknesses', 'thicknesses.variants'],
    });
  }

  async deleteItem(id: number): Promise<void> {
    await this.itemRepository.delete(id);
  }

  // CRUD for Thickness
  async createThickness(
    createThicknessDto: Partial<Thickness>,
  ): Promise<Thickness> {
    const thickness = this.thicknessRepository.create(createThicknessDto);
    return await this.thicknessRepository.save(thickness);
  }

  async deleteThickness(id: number): Promise<void> {
    await this.thicknessRepository.delete(id);
  }

  // CRUD for ItemVariants
  async createItemVariant(
    createItemVariantDto: Partial<ItemVariant>,
  ): Promise<ItemVariant> {
    const variant = this.itemVariantRepository.create(createItemVariantDto);
    return await this.itemVariantRepository.save(variant);
  }

  async deleteItemVariant(id: number): Promise<void> {
    await this.itemVariantRepository.delete(id);
  }

  async getAllItemsWithDetails(): Promise<Item[]> {
    return await this.itemRepository.find({
      relations: ['thicknesses', 'thicknesses.variants'],
    });
  }

// items.service.ts
async getSelectedItemDetailsPaginated(opts?: {
  page?: number;
  limit?: number;
  includeEmpty?: boolean; // kept for compatibility, ignored
}) {
  const page = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));
  const offset = (page - 1) * limit;

  // ✅ paginate on VARIANT for stable pages
  const qb = this.itemVariantRepository
    .createQueryBuilder('variant')
    .innerJoinAndSelect('variant.thickness', 'thickness')
    .innerJoinAndSelect('thickness.item', 'item')
    .leftJoinAndSelect('variant.itemNameDescription', 'variantDescription')
    // ⛔️ NO batches join — we show all variants regardless of stock/batches
    .select([
      // variant
      'variant.id',
      'variant.length',
      'variant.width',
      'variant.sheetsPerBox',
      'variant.origin',

      // thickness
      'thickness.id',
      'thickness.thickness',

      // item
      'item.id',
      'item.itemName',
      'item.type',

      // description
      'variantDescription.id',
      'variantDescription.itemNumber',
      'variantDescription.categoryName',
      'variantDescription.subCategory',
      'variantDescription.colorName',
      'variantDescription.designName',
    ])
    // stable order used by both pages and regrouping
    .orderBy('item.id', 'DESC')
    .addOrderBy('thickness.thickness', 'ASC')
    .addOrderBy('variant.id', 'ASC')
    .skip(offset)
    .take(limit + 1); // fetch one extra to know if more pages exist

  const variants = await qb.getMany();

  const hasMore = variants.length > limit;
  const pageSlice = hasMore ? variants.slice(0, limit) : variants;

  // 🔁 regroup into { items: [{ thicknesses: [{ variants: [...] }]}] }
  const itemMap = new Map<number, any>();

  for (const v of pageSlice) {
    const th = v.thickness;
    const it = th.item;

    // ensure item bucket
    let itemBucket = itemMap.get(it.id);
    if (!itemBucket) {
      itemBucket = {
        id: it.id,
        itemName: it.itemName,
        type: it.type,
        thicknesses: [],
      };
      itemMap.set(it.id, itemBucket);
    }

    // ensure thickness bucket
    let thBucket = itemBucket.thicknesses.find((t: any) => t.id === th.id);
    if (!thBucket) {
      thBucket = { id: th.id, thickness: th.thickness, variants: [] };
      itemBucket.thicknesses.push(thBucket);
    }

    // strip circular refs before pushing variant
    const { thickness, ...variantPlain } = v as any;
    thBucket.variants.push(variantPlain);
  }

  const data = Array.from(itemMap.values());

  return {
    page,
    limit,
    hasMore,
    data,
  };
}



 async createFullItem(data: {
  itemName: string;
  type: 'box' | 'sheet' | 'sqm';
  descriptions?: Array<{
    itemNumber: string;
    categoryName: string;
    subCategory: string;
    colorName: string;
    designName: string;
  }>;
  thicknesses: Array<{
    thickness: number | string;
    variants: Array<{
      length?: number | string;
      width?: number | string;
      sheetsPerBox?: number | string;
      origin: string;
      fixBox?: boolean;
      fixLength?: boolean;
      fixWidth?: boolean;
    }>;
  }>;
}): Promise<Item> {
  const { itemName, type, thicknesses: rawTh, descriptions = [] } = data;

  // 1) Normalize thickness & variant numeric fields
  const incoming = (rawTh ?? []).map((th) => ({
    thickness: Number(th.thickness),
    variants: Array.isArray(th.variants)
      ? th.variants.map((v: any) => ({
          length: type === 'sqm' ? 0 : Number(v?.length ?? 0),
          width: type === 'sqm' ? 0 : Number(v?.width ?? 0),
          sheetsPerBox:
            type === 'sheet' ? 1 : type === 'sqm' ? 0 : Number(v?.sheetsPerBox ?? 0),
          origin: v?.origin ?? '',
          fixBox: !!v?.fixBox,
          fixLength: !!v?.fixLength,
          fixWidth: !!v?.fixWidth,
        }))
      : [],
  }));

  // 2) Find or create global description entities (NO itemId)
  const resolveOrCreateDesc = async (desc: {
    itemNumber: string;
    categoryName: string;
    subCategory: string;
    colorName: string;
    designName: string;
  }) => {
    const where = {
      itemNumber: desc.itemNumber ?? '',
      categoryName: desc.categoryName ?? '',
      subCategory: desc.subCategory ?? '',
      colorName: desc.colorName ?? '',
      designName: desc.designName ?? '',
    };
    let ent = await this.itemNameDescriptionRepository.findOne({ where });
    if (!ent) {
      ent = this.itemNameDescriptionRepository.create(where);
      ent = await this.itemNameDescriptionRepository.save(ent);
    }
    return ent;
  };

  const descEntities = [];
  for (const d of descriptions) {
    descEntities.push(await resolveOrCreateDesc(d));
  }

  // 3) Load (or create) the item; DO NOT rely on item.descriptions (relation removed)
  let item = await this.itemRepository.findOne({
    where: { itemName, type },
    relations: ['thicknesses', 'thicknesses.variants'], // no 'descriptions' here anymore
  });

  const isNewItem = !item;

  if (isNewItem) {
    // 4) Create new item
    item = this.itemRepository.create({ itemName, type });
    item = await this.itemRepository.save(item);

    // 5) Create thicknesses + variants (attach description to variant by index if present)
    item.thicknesses = [];
    for (const thDto of incoming) {
      const thEnt = this.thicknessRepository.create({
        thickness: thDto.thickness,
        item,
      });

      thEnt.variants = thDto.variants.map((vDto, idx) =>
        this.itemVariantRepository.create({
          length: vDto.length,
          width: vDto.width,
          sheetsPerBox: vDto.sheetsPerBox,
          origin: vDto.origin,
          fixBox: vDto.fixBox,
          fixLength: vDto.fixLength,
          fixWidth: vDto.fixWidth,
          itemNameDescription: descEntities[idx] ?? null, // link global description
        }),
      );

      item.thicknesses.push(thEnt);
    }

    return this.itemRepository.save(item);
  }

  // 6) Existing item: ensure thicknesses and variants exist; link descriptions globally
  //    Reuse existing thickness if same value; create if missing
  for (const thDto of incoming) {
    let thEnt = item.thicknesses?.find(
      (t) => Number(t.thickness) === Number(thDto.thickness),
    );

    if (!thEnt) {
      thEnt = this.thicknessRepository.create({
        thickness: thDto.thickness,
        item,
      });
      thEnt = await this.thicknessRepository.save(thEnt);
      item.thicknesses.push(thEnt);
    }

    // Make sure variants array is present
    thEnt.variants = thEnt.variants || [];

    // For each incoming variant, check if it already exists (including description id match)
    for (const [i, vDto] of thDto.variants.entries()) {
      const matchingDesc = descEntities[i] ?? null; // global desc by index if provided

      const already = thEnt.variants.find(
        (v) =>
          Number(v.length) === Number(vDto.length) &&
          Number(v.width) === Number(vDto.width) &&
          Number(v.sheetsPerBox) === Number(vDto.sheetsPerBox) &&
          (v.origin ?? '') === (vDto.origin ?? '') &&
          (v.itemNameDescription?.id ?? null) === (matchingDesc?.id ?? null),
      );

      if (!already) {
        const newVar = this.itemVariantRepository.create({
          length: vDto.length,
          width: vDto.width,
          sheetsPerBox: vDto.sheetsPerBox,
          origin: vDto.origin,
          fixBox: vDto.fixBox,
          fixLength: vDto.fixLength,
          fixWidth: vDto.fixWidth,
          thickness: thEnt,
          itemNameDescription: matchingDesc ?? undefined, // link global desc
        });
        await this.itemVariantRepository.save(newVar);
        thEnt.variants.push(newVar);
      }
    }
  }

  return item;
}


// items.service.ts

// items.service.ts

// Replace the existing getitemDetails with this paginated + fixed version.
// items.service.ts
async getitemDetails(opts?: { page?: number; limit?: number }): Promise<any[]> {
  const page = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(500, Math.max(1, Number(opts?.limit ?? 100)));
  const offset = (page - 1) * limit;

  const items = await this.itemRepository
    .createQueryBuilder('item')
    .leftJoinAndSelect('item.thicknesses', 'thickness')
    .leftJoinAndSelect('thickness.variants', 'variant')
    .leftJoinAndSelect('variant.itemNameDescription', 'variantDescription')
    .leftJoinAndSelect('variant.batches', 'batch')
    .select([
      'item.id',
      'item.itemName',
      'item.type',

      'thickness.id',
      'thickness.thickness',

      'variant.id',
      'variant.length',
      'variant.width',
      'variant.sheetsPerBox',
      'variant.origin',
      'variant.itemNameDescriptionId',

      'variantDescription.id',
      'variantDescription.categoryName',
      'variantDescription.subCategory',
      'variantDescription.colorName',
      'variantDescription.designName',

      'batch.id',
      'batch.condition',
      'batch.dateReceived',
      'batch.balanceOFR',
    ])
    .orderBy('item.id', 'DESC')
    .addOrderBy('thickness.thickness', 'ASC')
    .addOrderBy('variant.id', 'ASC')
    .skip(offset)
    .take(limit)
    .getMany();

  const result: any[] = [];

  items.forEach((item) => {
    (item.thicknesses || []).forEach((th) => {
      (th.variants || []).forEach((variant) => {
        result.push({
          itemId: item.id,
          itemName: item.itemName,
          type: item.type,

          // 👇 return real Variant PK
          variantId: variant.id,

          thickness: Number(th.thickness),
          length: Number(variant.length),
          width: Number(variant.width),
          sheetsPerBox: Number(variant.sheetsPerBox),
          origin: variant.origin || null,
          itemNameDescriptionId: variant.itemNameDescriptionId || null,
          itemNameDescription: variant.itemNameDescription
            ? {
                id: variant.itemNameDescription.id,
                categoryName: variant.itemNameDescription.categoryName,
                subCategory: variant.itemNameDescription.subCategory,
                colorName: variant.itemNameDescription.colorName,
                designName: variant.itemNameDescription.designName,
              }
            : null,

          // real batch ids remain
          batches: (variant.batches || []).map((b) => ({
            id: b.id,
            condition: b.condition,
            dateReceived: b.dateReceived,
            balanceOFR: b.balanceOFR,
          })),
        });
      });
    });
  });

  return result;
}







// === Helpers (INSIDE ItemsService class) ===
private normalizeArabic(s: string) {
  if (!s) return s;
  return s.replace(/أ|إ|آ/g, 'ا').trim();
}

/** Parse "5.5ملم ابيض" -> { thickness, cleanName, nmNorm } */
private parseThicknessFromQ(q: string): { thickness?: number; cleanName?: string; nmNorm?: string } {
  if (!q) return {};
  const trimmed = q.trim();

  const m = trimmed.match(/^\s*(\d+(?:\.\d+)?)\s*ملم\s*(.*)$/i);
  if (m) {
    const thickness = Number(m[1]);
    const rest = (m[2] || '').trim();
    return { thickness, cleanName: rest, nmNorm: this.normalizeArabic(rest) };
  }

  const m2 = trimmed.match(/^\s*(\d+(?:\.\d+)?)/);
  if (m2) {
    const rest = trimmed.replace(m2[0], '').trim();
    return { thickness: Number(m2[1]), cleanName: rest, nmNorm: this.normalizeArabic(rest) };
  }

  return { cleanName: trimmed, nmNorm: this.normalizeArabic(trimmed) };
}

/** Parse "200*321-023" -> { length:200, width:321, spb:23, type:'box' } */
private parseDims(dims?: string) {
  if (!dims) return {};
  const text = dims.trim();
  const out: any = {};

  const [left, right] = text.split('-');
  if (right && right.trim() !== '') {
    const spb = parseInt(right.trim().replace(/^0+/, '') || '0', 10);
    if (!Number.isNaN(spb) && spb > 0) {
      out.spb = spb;
      out.type = 'box';
    }
  }

  const parts = (left || text).split('*').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 1) {
    const L = Number(parts[0]);
    if (!Number.isNaN(L)) out.length = L;
  }
  if (parts.length >= 2) {
    const W = Number(parts[1]);
    if (!Number.isNaN(W)) out.width = W;
  }
  return out;
}

/** Base QB for modal search */
private baseQBForModal() {
  return this.itemRepository
    .createQueryBuilder('item')
    .leftJoinAndSelect('item.thicknesses', 'thickness')
    .leftJoinAndSelect('thickness.variants', 'variant')
    .leftJoinAndSelect('variant.itemNameDescription', 'variantDescription')
    .leftJoinAndSelect('variant.batches', 'batch')
    .select([
      'item.id',
      'item.itemName',
      'item.type',
      'thickness.id',
      'thickness.thickness',
      'variant.id',
      'variant.length',
      'variant.width',
      'variant.sheetsPerBox',
      'variant.origin',
      'variantDescription.id',
      'variantDescription.itemNumber',
      'variantDescription.categoryName',
      'variantDescription.subCategory',
      'variantDescription.colorName',
      'variantDescription.designName',
      'batch.id',
      'batch.condition',
      'batch.dateReceived',
      'batch.balanceOFR',
    ]);
}

/** Execute + prune (optionally keep variants without batches) + log summary */
private async runAndFilter(
  qb: ReturnType<ItemsService['baseQBForModal']>,
  page: number,
  limit: number,
  opts?: { includeEmpty?: boolean }
) {
  const includeEmpty = !!opts?.includeEmpty;
  const q2 = qb.clone().skip((page - 1) * limit).take(limit);
  console.log('[SRV] SQL:', q2.getSql());
  console.log('[SRV] SQL params:', q2.getParameters());
  console.time('[SRV] getMany');
  const results = await q2.getMany();
  console.timeEnd('[SRV] getMany');

  let before = 0,
    after = 0,
    batches = 0,
    items = results.length,
    thCount = 0;

  for (const it of results) {
    for (const th of it.thicknesses || []) {
      thCount++;
      before += (th.variants || []).length;

      for (const v of th.variants || []) {
        (v as any).batchCount = (v.batches || []).length;
      }

      if (!includeEmpty) {
        th.variants = (th.variants || []).filter((v) => {
          const keep = (v.batches || []).length > 0;
          if (keep) batches += v.batches.length;
          return keep;
        });
      } else {
        batches += (th.variants || []).reduce((acc, v) => acc + (v.batches?.length || 0), 0);
      }

      after += th.variants.length;
    }
    if (!includeEmpty) {
      it.thicknesses = (it.thicknesses || []).filter((th) => (th.variants || []).length > 0);
    }
  }

  console.log('[SRV] filter-summary:', {
    items,
    thicknesses: thCount,
    variantsBefore: before,
    variantsAfter: after,
    totalBatches: batches,
    includeEmpty,
  });

  return results;
}





/** Core search used by the modal (swap-aware, tolerant, safe) */
async searchForModalPOS(params: {
  q: string;
  dims?: string;
  length?: number;
  width?: number;
  spb?: number;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  page: number;
  limit: number;
  includeEmpty?: boolean;
}) {
  console.log('========================================================');
  console.log('[SRV] searchForModalPOS params:', params);

  const { q, dims, page, limit, includeEmpty } = params;

  // Parse tokens
  const { thickness, cleanName, nmNorm } = this.parseThicknessFromQ(q || '');
  const parsedDims = this.parseDims(dims);
  const length = params.length ?? parsedDims.length;
  const width  = params.width  ?? parsedDims.width;
  const spb    = params.spb    ?? parsedDims.spb;
  const type   = params.type   ?? parsedDims.type;

  console.log('[SRV] parsed tokens:', {
    thickness,
    cleanName,
    nmNorm,
    length,
    width,
    spb,
    type,
    page,
    limit,
  });

  const qb = this.baseQBForModal();

  // Name filter (Arabic normalization OR raw)
  if (cleanName && cleanName.length > 0) {
    qb.andWhere(
      `(
        REPLACE(REPLACE(REPLACE(item.itemName, 'أ','ا'),'إ','ا'),'آ','ا') LIKE :nm
        OR item.itemName LIKE :nmRaw
      )`,
      { nm: `%${nmNorm || cleanName}%`, nmRaw: `%${cleanName}%` }
    );
  }

  // Optional type
  if (type) {
    qb.andWhere('item.type = :tp', { tp: type });
  }

  // Thickness tolerance
  if (typeof thickness === 'number' && !Number.isNaN(thickness)) {
    qb.andWhere('ABS(thickness.thickness - :th) < :thTol', { th: thickness, thTol: 0.011 });
  }

  // Dimensions tolerance + swap
  const tol = 0.51;
  const hasLen = typeof length === 'number' && !Number.isNaN(length);
  const hasWid = typeof width  === 'number' && !Number.isNaN(width);

  if (hasLen && hasWid) {
    qb.andWhere(
      `(
        (ABS(variant.length - :len) < :tol AND ABS(variant.width - :wid) < :tol)
        OR
        (ABS(variant.length - :wid) < :tol AND ABS(variant.width - :len) < :tol)
      )`,
      { len: length!, wid: width!, tol }
    );
  } else if (hasLen) {
    qb.andWhere('ABS(variant.length - :len) < :tol', { len: length!, tol });
  } else if (hasWid) {
    qb.andWhere('ABS(variant.width - :wid) < :tol', { wid: width!, tol });
  }

  // Sheets/box
  if (typeof spb === 'number' && !Number.isNaN(spb)) {
    qb.andWhere('variant.sheetsPerBox = :spb', { spb });
  }

  qb
    .orderBy('item.id', 'DESC')
    .addOrderBy('thickness.thickness', 'ASC')
    .addOrderBy('variant.id', 'ASC');

  // Log summary
  const appliedFilters: string[] = [];
  if (cleanName) appliedFilters.push(`normalized(item.itemName) LIKE %${nmNorm || cleanName}% OR raw LIKE %${cleanName}%`);
  if (type) appliedFilters.push(`item.type = ${type}`);
  if (typeof thickness === 'number') appliedFilters.push(`ABS(thickness.thickness - ${thickness}) < 0.011`);
  if (hasLen && hasWid) {
    appliedFilters.push(`dims ~ (${length}×${width}) with swap & tol ${tol}`);
  } else if (hasLen) {
    appliedFilters.push(`length ~ ${length} tol ${tol}`);
  } else if (hasWid) {
    appliedFilters.push(`width ~ ${width} tol ${tol}`);
  }
  if (typeof spb === 'number') appliedFilters.push(`variant.sheetsPerBox = ${spb}`);
  console.log('[SRV] appliedFilters:', appliedFilters);

 const pageNum  = Number.isFinite(Number(params.page))  ? Math.max(1, Number(params.page))  : 1;
const limitNum = Number.isFinite(Number(params.limit)) ? Math.min(500, Math.max(1, Number(params.limit))) : 50;

// ...
const results = await this.runAndFilter(qb, pageNum, limitNum, { includeEmpty });



  if (!results.length) {
    console.log('[SRV] No records matched. Tips:', [
      '• Verify SPB (e.g., -023 → 23).',
      '• Try includeEmpty=1 to see variants without stock.',
      '• Try removing dims to see if name+thickness match.',
      '• Check spelling/normalization (أبيض vs ابيض).',
    ]);
  }
  console.log('========================================================');
  return results;
}

}


