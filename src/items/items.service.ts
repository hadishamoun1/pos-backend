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
// items.service.ts
async getSelectedItemDetailsPaginated(opts?: {
  page?: number;
  limit?: number;
  includeEmpty?: boolean; // kept for compatibility, ignored
}) {
  const page  = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));
  const offset = (page - 1) * limit;

  const qb = this.itemVariantRepository
    .createQueryBuilder('variant')
    .innerJoinAndSelect('variant.thickness', 'thickness')
    .innerJoinAndSelect('thickness.item', 'item')
    .leftJoinAndSelect('variant.itemNameDescription', 'variantDescription')
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
      'thickness.sort_index',
      // item
      'item.id',
      'item.itemName',
      'item.type',
      'item.sortIndex', // property name (maps to DB `sort_index`)
      // description
      'variantDescription.id',
      'variantDescription.itemNumber',
      'variantDescription.categoryName',
      'variantDescription.subCategory',
      'variantDescription.colorName',
      'variantDescription.designName',
    ])

    // --- Portable NULLS LAST emulation via computed selects ---
    // Use DB column names inside the CASE expressions.
    .addSelect('CASE WHEN item.sort_index IS NULL THEN 1 ELSE 0 END', 'item_sort_nulls')
    .addSelect('CASE WHEN thickness.sort_index IS NULL THEN 1 ELSE 0 END', 'th_sort_nulls')

    // Items: non-null sort_index first -> sortIndex ASC -> itemName ASC
    .orderBy('item_sort_nulls', 'ASC')
    .addOrderBy('item.sortIndex', 'ASC') // property name
    .addOrderBy('item.itemName', 'ASC')

    // Thickness: non-null sort_index first -> sort_index ASC -> thickness ASC
    .addOrderBy('th_sort_nulls', 'ASC')
    .addOrderBy('thickness.sort_index', 'ASC') // property is snake_case here
    .addOrderBy('thickness.thickness', 'ASC')

    // Variants stable inside thickness
    .addOrderBy('variant.id', 'ASC')

    .skip(offset)
    .take(limit + 1);

  const variants = await qb.getMany();

  const hasMore = variants.length > limit;
  const pageSlice = hasMore ? variants.slice(0, limit) : variants;

  // regroup into items -> thicknesses -> variants, preserving SQL order
  const itemMap = new Map<number, any>();

  for (const v of pageSlice) {
    const th = v.thickness;
    const it = th.item;

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

    let thBucket = itemBucket.thicknesses.find((t: any) => t.id === th.id);
    if (!thBucket) {
      thBucket = { id: th.id, thickness: th.thickness, variants: [] };
      itemBucket.thicknesses.push(thBucket);
    }

    const { thickness, ...variantPlain } = v as any; // strip circular ref
    thBucket.variants.push(variantPlain);
  }

  return {
    page,
    limit,
    hasMore,
    data: Array.from(itemMap.values()),
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
async getitemDetails(opts?: { page?: number; limit?: number }) {
  // ---- paging is by *rows* (table lines), not by item-name groups ----
  const page  = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(500, Math.max(1, Number(opts?.limit ?? 100)));
  const start = (page - 1) * limit;

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const convertBalanceFromSqm = (params: {
    itemType: string | null | undefined;
    lengthCm: number;
    widthCm: number;
    sheetsPerBox: number;
    balanceSqm: number;
  }) => {
    const { itemType, lengthCm, widthCm, sheetsPerBox, balanceSqm } = params;
    const perSheetSqm =
      toNum(lengthCm) > 0 && toNum(widthCm) > 0
        ? (toNum(lengthCm) * toNum(widthCm)) / 10000
        : 0;

    const type = String(itemType || "").toLowerCase();
    if (type === "box") {
      const perBoxSqm = perSheetSqm * Math.max(1, toNum(sheetsPerBox));
      return perBoxSqm > 0 ? balanceSqm / perBoxSqm : balanceSqm;
    }
    if (type === "sheet") {
      return perSheetSqm > 0 ? balanceSqm / perSheetSqm : balanceSqm;
    }
    return balanceSqm; // sqm/unit: already in target unit
  };

  // -------------------------------------------------------------------
  // 1) Load minimal graph; custom ordering done in JS
  // -------------------------------------------------------------------
  const entities = await this.itemRepository
    .createQueryBuilder("item")
    .leftJoinAndSelect("item.thicknesses", "thickness")
    .leftJoinAndSelect("thickness.variants", "variant")
    .leftJoinAndSelect("variant.itemNameDescription", "variantDescription")
    .leftJoinAndSelect("variant.batches", "batch")
    .select([
      // item
      "item.id",
      "item.itemName",
      "item.type",
      "item.sortIndex",
      // thickness
      "thickness.id",
      "thickness.thickness",
      "thickness.sort_index",
      // variant
      "variant.id",
      "variant.length",
      "variant.width",
      "variant.sheetsPerBox",
      "variant.origin",
      "variant.itemNameDescriptionId",
      // desc
      "variantDescription.id",
      "variantDescription.categoryName",
      "variantDescription.subCategory",
      "variantDescription.colorName",
      "variantDescription.designName",
      // batch
      "batch.id",
      "batch.condition",
      "batch.dateReceived",
      "batch.balanceOFR",
    ])
    .orderBy("item.id", "ASC")
    .addOrderBy("thickness.id", "ASC")
    .addOrderBy("variant.id", "ASC")
    .addOrderBy("batch.id", "ASC")
    .getMany();

  // -------------------------------------------------------------------
  // 2) Flatten (NOW FILTER OUT ZERO/NEGATIVE STOCK)
  // -------------------------------------------------------------------
  type Flat = {
    itemId: number;
    itemName: string;
    itemSortIndex: number | null;
    type: string; // 'box' | 'sheet' | 'sqm' | 'unit'
    thicknessId: number;
    thickness: number;
    thicknessSortIndex: number | null;
    variantId: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string | null;
    itemNameDescriptionId: number | null;
    itemNameDescription: any | null;
    batches: Array<{
      id: number;
      condition: string | null;
      dateReceived: string | Date | null;
      balanceOFRSqm: number;
      balanceOFR: number;
    }>;
  };

  const flat: Flat[] = [];
  for (const item of entities) {
    for (const th of item.thicknesses || []) {
      for (const v of th.variants || []) {
        const lengthNum = toNum(v.length);
        const widthNum  = toNum(v.width);
        const spbNum    = Math.max(1, toNum(v.sheetsPerBox));

        // map → convert → FILTER: keep only batches with positive stock
        const batches = (v.batches || [])
          .map((b) => {
            const balanceSqm = toNum(b.balanceOFR);
            const converted  = convertBalanceFromSqm({
              itemType: item.type,
              lengthCm: lengthNum,
              widthCm: widthNum,
              sheetsPerBox: spbNum,
              balanceSqm,
            });
            return {
              id: b.id,
              condition: b.condition ?? null,
              dateReceived: b.dateReceived ?? null,
              balanceOFRSqm: Number(balanceSqm.toFixed(2)),
              balanceOFR: Number(converted.toFixed(2)),
            };
          })
          .filter((bb) => toNum(bb.balanceOFR) > 0); // <<< filter no-stock batches

        // if no batches remain → SKIP this variant entirely
        if (!batches.length) continue;

        flat.push({
          itemId: item.id,
          itemName: item.itemName,
          itemSortIndex: (item as any)?.sortIndex ?? null,
          type: String(item.type || "").toLowerCase(),
          thicknessId: th.id,
          thickness: toNum(th.thickness),
          thicknessSortIndex: (th as any)?.sort_index ?? null,
          variantId: v.id,
          length: lengthNum,
          width: widthNum,
          sheetsPerBox: spbNum,
          origin: v.origin || null,
          itemNameDescriptionId: v.itemNameDescriptionId || null,
          itemNameDescription: v.itemNameDescription
            ? {
                id: v.itemNameDescription.id,
                categoryName: v.itemNameDescription.categoryName,
                subCategory: v.itemNameDescription.subCategory,
                colorName: v.itemNameDescription.colorName,
                designName: v.itemNameDescription.designName,
              }
            : null,
          batches,
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 3) Order (box → sheet → sqm per dims, inside thickness, inside itemName)
  // -------------------------------------------------------------------
  const nullLast = (n: any) => (n == null ? Number.POSITIVE_INFINITY : Number(n));
  const typeRank = (t: string) => (t === "box" ? 0 : t === "sheet" ? 1 : t === "sqm" ? 2 : 3);

  const byName = new Map<string, Flat[]>();
  for (const r of flat) {
    if (!byName.has(r.itemName)) byName.set(r.itemName, []);
    byName.get(r.itemName)!.push(r);
  }

  const nameKeys = Array.from(byName.keys()).sort((a, b) => {
    const aMin = Math.min(...byName.get(a)!.map((x) => nullLast(x.itemSortIndex)));
    const bMin = Math.min(...byName.get(b)!.map((x) => nullLast(x.itemSortIndex)));
    if (aMin !== bMin) return aMin - bMin;
    return a.localeCompare(b);
  });

  const ordered: Flat[] = [];

  for (const name of nameKeys) {
    const rowsOfName = byName.get(name)!;

    const byTh = new Map<number, Flat[]>();
    for (const r of rowsOfName) {
      if (!byTh.has(r.thickness)) byTh.set(r.thickness, []);
      byTh.get(r.thickness)!.push(r);
    }

    const thKeys = Array.from(byTh.keys()).sort((ta, tb) => {
      const aArr = byTh.get(ta)!;
      const bArr = byTh.get(tb)!;
      const aMin = Math.min(...aArr.map((x) => nullLast(x.thicknessSortIndex)));
      const bMin = Math.min(...bArr.map((x) => nullLast(x.thicknessSortIndex)));
      if (aMin !== bMin) return aMin - bMin;
      return ta - tb;
    });

    for (const th of thKeys) {
      const rowsTh = byTh.get(th)!;

      const dimmed    = rowsTh.filter((r) => r.length > 0 && r.width > 0);
      const nonDimmed = rowsTh.filter((r) => !(r.length > 0 && r.width > 0) || r.type === "sqm");

      const byDims = new Map<string, Flat[]>();
      for (const r of dimmed) {
        const k = `${r.length}|${r.width}`;
        if (!byDims.has(k)) byDims.set(k, []);
        byDims.get(k)!.push(r);
      }

      const dimKeys = Array.from(byDims.keys()).sort((ka, kb) => {
        const [aL, aW] = ka.split("|").map(Number);
        const [bL, bW] = kb.split("|").map(Number);
        const aArea = aL * aW, bArea = bL * bW;
        if (aArea !== bArea) return bArea - aArea;
        if (aL !== bL) return bL - aL;
        return bW - aW;
      });

      for (const dk of dimKeys) {
        const g = byDims.get(dk)!;
        const boxes  = g.filter((x) => x.type === "box")
                        .sort((a, b) => (b.sheetsPerBox || 0) - (a.sheetsPerBox || 0) || a.variantId - b.variantId);
        const sheets = g.filter((x) => x.type === "sheet").sort((a, b) => a.variantId - b.variantId);
        const sqms   = g.filter((x) => x.type === "sqm");
        ordered.push(...boxes, ...sheets, ...sqms);
      }

      const sqmOthers    = nonDimmed.filter((x) => x.type === "sqm").sort((a, b) => a.variantId - b.variantId);
      const noDimsNonSqm = nonDimmed.filter((x) => x.type !== "sqm");
      ordered.push(...sqmOthers, ...noDimsNonSqm);
    }
  }

  // -------------------------------------------------------------------
  // 4) Expand to *rows* and paginate AFTER ordering
  //     (No empty “no-stock” rows will be created)
  // -------------------------------------------------------------------
  type Row = {
    itemId: number;
    itemName: string;
    type: string;
    variantId: number;
    thickness: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string | null;
    itemNameDescriptionId: number | null;
    itemNameDescription: any | null;
    batchId?: number | null;
    condition?: string | null;
    dateReceived?: string | Date | null;
    balanceOFR?: number | null;
  };

  const allRows: Row[] = [];
  for (const r of ordered) {
    // every r has at least one batch (by earlier filter)
    for (const b of r.batches) {
      allRows.push({
        itemId: r.itemId,
        itemName: r.itemName,
        type: r.type,
        variantId: r.variantId,
        thickness: r.thickness,
        length: r.length,
        width: r.width,
        sheetsPerBox: r.sheetsPerBox,
        origin: r.origin,
        itemNameDescriptionId: r.itemNameDescriptionId,
        itemNameDescription: r.itemNameDescription,
        batchId: b.id,
        condition: b.condition,
        dateReceived: b.dateReceived,
        balanceOFR: b.balanceOFR,
      });
    }
  }

  const totalRows  = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const pageRows   = allRows.slice(start, start + limit);

  return {
    page,
    limit,
    totalRows,
    totalPages,
    hasMore: page < totalPages,
    data: pageRows,
  };
}


// ========= Helpers =========

  private toNum(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /** Normalize Arabic variants of alif, trim spaces */
  private normalizeArabic(s: string) {
    if (!s) return s;
    return s.replace(/أ|إ|آ/g, 'ا').trim();
  }

  /** Parse "5.5ملم ابيض" -> { thickness, cleanName, nmNorm } */
  private parseThicknessFromQ(q: string): { thickness?: number; cleanName?: string; nmNorm?: string } {
    if (!q) return {};
    const trimmed = q.trim();

    // "5.5ملم something"
    const m = trimmed.match(/^\s*(\d+(?:\.\d+)?)\s*ملم\s*(.*)$/i);
    if (m) {
      const thickness = Number(m[1]);
      const rest = (m[2] || '').trim();
      return { thickness, cleanName: rest, nmNorm: this.normalizeArabic(rest) };
    }

    // starts with a number
    const m2 = trimmed.match(/^\s*(\d+(?:\.\d+)?)/);
    if (m2) {
      const rest = trimmed.replace(m2[0], '').trim();
      return { thickness: Number(m2[1]), cleanName: rest, nmNorm: this.normalizeArabic(rest) };
    }

    // no thickness found, treat all as name
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

  /**
   * Convert a sqm balance to "units" depending on item.type:
   * - box   => divide by (per-sheet sqm * sheetsPerBox)
   * - sheet => divide by per-sheet sqm
   * - sqm   => leave as-is
   * Returns both sqm and converted, each rounded.
   *
   * If you want integers for box/sheet, set roundUnitsToInt=true.
   */
  private convertAndRoundBalance(
    itemType: string | null | undefined,
    lengthCm: number,
    widthCm: number,
    sheetsPerBox: number,
    balanceSqmRaw: any,
    roundUnitsToInt = false, // flip to true if you want integer boxes/sheets
  ) {
    const balanceSqm = this.toNum(balanceSqmRaw);
    const perSheetSqm =
      this.toNum(lengthCm) > 0 && this.toNum(widthCm) > 0
        ? (this.toNum(lengthCm) * this.toNum(widthCm)) / 10000
        : 0;

    const type = (itemType || "").toLowerCase();
    let converted = balanceSqm;

    if (type === "box") {
      const perBoxSqm = perSheetSqm * Math.max(1, this.toNum(sheetsPerBox));
      converted = perBoxSqm > 0 ? balanceSqm / perBoxSqm : balanceSqm;
    } else if (type === "sheet") {
      converted = perSheetSqm > 0 ? balanceSqm / perSheetSqm : balanceSqm;
    } // else "sqm" (or unknown) -> leave as sqm

    const balanceOFRSqm = Number(balanceSqm.toFixed(2));
    const balanceOFR = roundUnitsToInt && (type === 'box' || type === 'sheet')
      ? Math.round(converted)
      : Number(converted.toFixed(2));

    return { balanceOFRSqm, balanceOFR };
  }

  // ========= Shared QB for modal =========

  /** Base QB for modal search (keeps everything we need) */
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
        'batch.balanceOFR', // stored sqm
      ]);
  }

  /**
   * Execute + (optionally) prune variants without batches +
   * ✅ convert & round each batch's balances (sqm → boxes/sheets/sqm)
   */
  private async runAndFilter(
    qb: ReturnType<ItemsService['baseQBForModal']>,
    page: number,
    limit: number,
    opts?: { includeEmpty?: boolean; roundUnitsToInt?: boolean }
  ) {
    const includeEmpty = !!opts?.includeEmpty;
    const roundUnitsToInt = !!opts?.roundUnitsToInt;

    const q2 = qb.clone().skip((page - 1) * limit).take(limit);



    const results = await q2.getMany();


    let before = 0,
        after = 0,
        batches = 0,
        items = results.length,
        thCount = 0;

    for (const it of results) {
      for (const th of it.thicknesses || []) {
        thCount++;
        before += (th.variants || []).length;

        // prune empty variants if requested
        if (!includeEmpty) {
          th.variants = (th.variants || []).filter((v) => {
            const keep = (v.batches || []).length > 0;
            if (keep) batches += v.batches.length;
            return keep;
          });
        } else {
          batches += (th.variants || []).reduce((acc, v) => acc + (v.batches?.length || 0), 0);
        }

        // ✅ convert and round each batch's balances
        for (const v of th.variants || []) {
          const len = this.toNum(v.length);
          const wid = this.toNum(v.width);
          const spb = Math.max(1, this.toNum(v.sheetsPerBox));

          v.batches = (v.batches || []).map((b: any) => {
            const { balanceOFRSqm, balanceOFR } = this.convertAndRoundBalance(
              it.type,
              len,
              wid,
              spb,
              b.balanceOFR,          // raw sqm from DB
              roundUnitsToInt        // toggle integer units for box/sheet
            );
            return {
              ...b,
              balanceOFRSqm, // number (sqm), rounded to 2
              balanceOFR,    // number (units for box/sheet, else sqm), rounded
            };
          });
        }

        after += th.variants.length;
      }

      if (!includeEmpty) {
        it.thicknesses = (it.thicknesses || []).filter((t) => (t.variants || []).length > 0);
      }
    }


    return results;
  }

  // ========= Public: modal search =========

  /**
   * Core search used by the modal (tolerant thickness/dims, optional pruning)
   *
   * Example params:
   * {
   *   q: "5.5ملم ابيض",
   *   dims: "225*321-012",
   *   page: 1,
   *   limit: 50,
   *   includeEmpty: false
   * }
   */
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
    roundUnitsToInt?: boolean;
  }) {
  

    const { q, dims, includeEmpty, roundUnitsToInt } = params;

    // Parse tokens
    const { thickness, cleanName, nmNorm } = this.parseThicknessFromQ(q || '');
    const parsedDims = this.parseDims(dims);
    const length = params.length ?? parsedDims.length;
    const width  = params.width  ?? parsedDims.width;
    const spb    = params.spb    ?? parsedDims.spb;
    const type   = params.type   ?? parsedDims.type;



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

    // Optional item.type
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

    // Sheets/box exact match if provided
    if (typeof spb === 'number' && !Number.isNaN(spb)) {
      qb.andWhere('variant.sheetsPerBox = :spb', { spb });
    }

    qb
      .orderBy('item.id', 'DESC')
      .addOrderBy('thickness.thickness', 'ASC')
      .addOrderBy('variant.id', 'ASC');

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


    const pageNum  = Number.isFinite(Number(params.page))  ? Math.max(1, Number(params.page))  : 1;
    const limitNum = Number.isFinite(Number(params.limit)) ? Math.min(500, Math.max(1, Number(params.limit))) : 50;

    const results = await this.runAndFilter(qb, pageNum, limitNum, { includeEmpty, roundUnitsToInt });

    if (!results.length) {
      console.log('[SRV] No records matched. Tips:', [
        '• Verify SPB (e.g., -023 → 23).',
        '• Try includeEmpty=1 to see variants without stock.',
        '• Try removing dims to see if name+thickness match.',
        '• Check spelling/normalization (أبيض vs ابيض).',
      ]);
    }


    return results;
  }



  // items.service.ts
async getitemDetailsAllBatches(opts?: { page?: number; limit?: number }) {
  // ---- paginate by *rows* (table lines) ----
  const page  = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(500, Math.max(1, Number(opts?.limit ?? 100)));
  const start = (page - 1) * limit;

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const convertBalanceFromSqm = (params: {
    itemType: string | null | undefined;
    lengthCm: number;
    widthCm: number;
    sheetsPerBox: number;
    balanceSqm: number;
  }) => {
    const { itemType, lengthCm, widthCm, sheetsPerBox, balanceSqm } = params;
    const perSheetSqm =
      toNum(lengthCm) > 0 && toNum(widthCm) > 0
        ? (toNum(lengthCm) * toNum(widthCm)) / 10000
        : 0;

    const type = String(itemType || "").toLowerCase();
    if (type === "box") {
      const perBoxSqm = perSheetSqm * Math.max(1, toNum(sheetsPerBox));
      return perBoxSqm > 0 ? balanceSqm / perBoxSqm : balanceSqm;
    }
    if (type === "sheet") {
      return perSheetSqm > 0 ? balanceSqm / perSheetSqm : balanceSqm;
    }
    // sqm / unit → already in target unit
    return balanceSqm;
  };

  // -------------------------------------------------------------------
  // 1) Load minimal graph (stable base order). Final order is in JS.
  // -------------------------------------------------------------------
  const entities = await this.itemRepository
    .createQueryBuilder("item")
    .leftJoinAndSelect("item.thicknesses", "thickness")
    .leftJoinAndSelect("thickness.variants", "variant")
    .leftJoinAndSelect("variant.itemNameDescription", "variantDescription")
    .leftJoinAndSelect("variant.batches", "batch")
    .select([
      // item
      "item.id",
      "item.itemName",
      "item.type",
      "item.sortIndex",        // entity is camelCase; DB col is sort_index
      // thickness
      "thickness.id",
      "thickness.thickness",
      "thickness.sort_index",  // entity exposes snake_case
      // variant
      "variant.id",
      "variant.length",
      "variant.width",
      "variant.sheetsPerBox",
      "variant.origin",
      "variant.itemNameDescriptionId",
      // description
      "variantDescription.id",
      "variantDescription.categoryName",
      "variantDescription.subCategory",
      "variantDescription.colorName",
      "variantDescription.designName",
      // batches (we will include *all* batches, even <= 0)
      "batch.id",
      "batch.condition",
      "batch.dateReceived",
      "batch.balanceOFR",
    ])
    .orderBy("item.id", "ASC")
    .addOrderBy("thickness.id", "ASC")
    .addOrderBy("variant.id", "ASC")
    .addOrderBy("batch.id", "ASC")
    .getMany();

  // -------------------------------------------------------------------
  // 2) Flatten everything (NO stock filtering here)
  // -------------------------------------------------------------------
  type Flat = {
    itemId: number;
    itemName: string;
    itemSortIndex: number | null;
    type: string; // 'box' | 'sheet' | 'sqm' | 'unit'
    thicknessId: number;
    thickness: number;
    thicknessSortIndex: number | null;
    variantId: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string | null;
    itemNameDescriptionId: number | null;
    itemNameDescription: any | null;
    batches: Array<{
      id: number;
      condition: string | null;
      dateReceived: string | Date | null;
      balanceOFRSqm: number; // original sqm
      balanceOFR: number;    // converted count (may be 0 or negative)
    }>;
  };

  const flat: Flat[] = [];

  for (const item of entities) {
    for (const th of item.thicknesses || []) {
      for (const v of th.variants || []) {
        const lengthNum = toNum(v.length);
        const widthNum  = toNum(v.width);
        const spbNum    = Math.max(1, toNum(v.sheetsPerBox));

        // Map every batch (keep even if converted balance <= 0)
        const mappedBatches = (v.batches || []).map((b) => {
          const balanceSqm = toNum(b.balanceOFR);
          const converted  = convertBalanceFromSqm({
            itemType: item.type,
            lengthCm: lengthNum,
            widthCm: widthNum,
            sheetsPerBox: spbNum,
            balanceSqm,
          });
          return {
            id: b.id,
            condition: b.condition ?? null,
            dateReceived: b.dateReceived ?? null,
            balanceOFRSqm: Number(balanceSqm.toFixed(2)),
            balanceOFR: Number(converted.toFixed(2)),
          };
        });

        // Only push variants that *have a batch* (require batch presence)
        if (mappedBatches.length === 0) {
          continue; // skip variants without batches
        }

        flat.push({
          itemId: item.id,
          itemName: item.itemName,
          itemSortIndex: (item as any)?.sortIndex ?? null,
          type: String(item.type || "").toLowerCase(),
          thicknessId: th.id,
          thickness: toNum(th.thickness),
          thicknessSortIndex: (th as any)?.sort_index ?? null,
          variantId: v.id,
          length: lengthNum,
          width: widthNum,
          sheetsPerBox: spbNum,
          origin: v.origin || null,
          itemNameDescriptionId: v.itemNameDescriptionId || null,
          itemNameDescription: v.itemNameDescription
            ? {
                id: v.itemNameDescription.id,
                categoryName: v.itemNameDescription.categoryName,
                subCategory: v.itemNameDescription.subCategory,
                colorName: v.itemNameDescription.colorName,
                designName: v.itemNameDescription.designName,
              }
            : null,
          batches: mappedBatches, // includes zero/negative
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 3) Order (itemName → thickness → dims → type)
  // -------------------------------------------------------------------
  const nullLast = (n: any) => (n == null ? Number.POSITIVE_INFINITY : Number(n));
  const typeRank = (t: string) => (t === "box" ? 0 : t === "sheet" ? 1 : t === "sqm" ? 2 : 3);

  const byName = new Map<string, Flat[]>();
  for (const r of flat) {
    if (!byName.has(r.itemName)) byName.set(r.itemName, []);
    byName.get(r.itemName)!.push(r);
  }

  // Names: sort_index NULLS LAST, then name ASC
  const nameKeys = Array.from(byName.keys()).sort((a, b) => {
    const aMin = Math.min(...byName.get(a)!.map((x) => nullLast(x.itemSortIndex)));
    const bMin = Math.min(...byName.get(b)!.map((x) => nullLast(x.itemSortIndex)));
    if (aMin !== bMin) return aMin - bMin;
    return a.localeCompare(b);
  });

  const ordered: Flat[] = [];

  for (const name of nameKeys) {
    const rowsOfName = byName.get(name)!;

    // group by thickness
    const byTh = new Map<number, Flat[]>();
    for (const r of rowsOfName) {
      if (!byTh.has(r.thickness)) byTh.set(r.thickness, []);
      byTh.get(r.thickness)!.push(r);
    }

    // Thickness: th.sort_index NULLS LAST, then numeric ASC
    const thKeys = Array.from(byTh.keys()).sort((ta, tb) => {
      const aArr = byTh.get(ta)!;
      const bArr = byTh.get(tb)!;
      const aMin = Math.min(...aArr.map((x) => nullLast(x.thicknessSortIndex)));
      const bMin = Math.min(...bArr.map((x) => nullLast(x.thicknessSortIndex)));
      if (aMin !== bMin) return aMin - bMin;
      return ta - tb;
    });

    for (const th of thKeys) {
      const rowsTh = byTh.get(th)!;

      const dimmed     = rowsTh.filter((r) => r.length > 0 && r.width > 0);
      const nonDimmed  = rowsTh.filter((r) => !(r.length > 0 && r.width > 0) || r.type === "sqm");

      // group by dims
      const byDims = new Map<string, Flat[]>();
      for (const r of dimmed) {
        const k = `${r.length}|${r.width}`;
        if (!byDims.has(k)) byDims.set(k, []);
        byDims.get(k)!.push(r);
      }

      // dims order: area DESC → length DESC → width DESC
      const dimKeys = Array.from(byDims.keys()).sort((ka, kb) => {
        const [aL, aW] = ka.split("|").map(Number);
        const [bL, bW] = kb.split("|").map(Number);
        const aArea = aL * aW, bArea = bL * bW;
        if (aArea !== bArea) return bArea - aArea;
        if (aL !== bL) return bL - aL;
        return bW - aW;
      });

      // Emit box → sheet → sqm for each dims group
      for (const dk of dimKeys) {
        const g = byDims.get(dk)!;
        const boxes  = g.filter((x) => x.type === "box")
                        .sort((a, b) => (b.sheetsPerBox || 0) - (a.sheetsPerBox || 0) || a.variantId - b.variantId);
        const sheets = g.filter((x) => x.type === "sheet").sort((a, b) => a.variantId - b.variantId);
        const sqms   = g.filter((x) => x.type === "sqm");
        ordered.push(...boxes, ...sheets, ...sqms);
      }

      // then sqm without dims, then any other no-dims
      const sqmOthers     = nonDimmed.filter((x) => x.type === "sqm").sort((a, b) => a.variantId - b.variantId);
      const noDimsNonSqm  = nonDimmed.filter((x) => x.type !== "sqm");
      ordered.push(...sqmOthers, ...noDimsNonSqm);
    }
  }

  // -------------------------------------------------------------------
  // 4) Expand to *rows* (every batch yields a row) and paginate
  //     NOTE: we KEEP rows even if balanceOFR <= 0
  // -------------------------------------------------------------------
  type Row = {
    itemId: number;
    itemName: string;
    type: string;
    variantId: number;
    thickness: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string | null;
    itemNameDescriptionId: number | null;
    itemNameDescription: any | null;
    batchId: number | null;
    condition: string | null;
    dateReceived: string | Date | null;
    balanceOFR: number | null; // may be 0 or negative by design in this endpoint
  };

  const allRows: Row[] = [];
  for (const r of ordered) {
    // Only variants with batches were pushed earlier, so we can just expand
    for (const b of r.batches) {
      allRows.push({
        itemId: r.itemId,
        itemName: r.itemName,
        type: r.type,
        variantId: r.variantId,
        thickness: r.thickness,
        length: r.length,
        width: r.width,
        sheetsPerBox: r.sheetsPerBox,
        origin: r.origin,
        itemNameDescriptionId: r.itemNameDescriptionId,
        itemNameDescription: r.itemNameDescription,
        batchId: b.id,
        condition: b.condition,
        dateReceived: b.dateReceived,
        balanceOFR: b.balanceOFR, // keep 0/negative
      });
    }
  }

  const totalRows  = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const pageRows   = allRows.slice(start, start + limit);

  return {
    page,
    limit,
    totalRows,
    totalPages,
    hasMore: page < totalPages,
    data: pageRows,
  };
}


// Add this next to searchForModalPOS
async searchForModalPOSInStock(params: {
  q: string;
  dims?: string;
  length?: number;
  width?: number;
  spb?: number;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  page: number;
  limit: number;
  roundUnitsToInt?: boolean;
}) {


  const { q } = params;

  // Parse tokens exactly like your original
  const { thickness, cleanName, nmNorm } = this.parseThicknessFromQ(q || '');
  const parsedDims = this.parseDims(params.dims);
  const length = params.length ?? parsedDims.length;
  const width  = params.width  ?? parsedDims.width;
  const spb    = params.spb    ?? parsedDims.spb;
  const type   = params.type   ?? parsedDims.type;


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

  // Optional item.type
  if (type) qb.andWhere('item.type = :tp', { tp: type });

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

  // Sheets/box exact match if provided
  if (typeof spb === 'number' && !Number.isNaN(spb)) {
    qb.andWhere('variant.sheetsPerBox = :spb', { spb });
  }

  qb
    .orderBy('item.id', 'DESC')
    .addOrderBy('thickness.thickness', 'ASC')
    .addOrderBy('variant.id', 'ASC');

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


  const pageNum  = Number.isFinite(Number(params.page))  ? Math.max(1, Number(params.page))  : 1;
  const limitNum = Number.isFinite(Number(params.limit)) ? Math.min(500, Math.max(1, Number(params.limit))) : 50;

  // ⬇️ Force includeEmpty = false so runAndFilter prefers only in-stock
  const results = await this.runAndFilter(qb, pageNum, limitNum, {
    includeEmpty: false,
    roundUnitsToInt: params.roundUnitsToInt,
  });

  // Safety trim: drop batches with balance <= 0 (in case rounding/conversion left any)
  // and drop empty variants/thicknesses/items after trimming.
  const filtered = (results || [])
    .map((item: any) => ({
      ...item,
      thicknesses: (item.thicknesses || [])
        .map((th: any) => ({
          ...th,
          variants: (th.variants || [])
            .map((v: any) => ({
              ...v,
              batches: (v.batches || []).filter((b: any) => Number(b.balanceOFR) > 0),
            }))
            .filter((v: any) => Array.isArray(v.batches) && v.batches.length > 0),
        }))
        .filter((th: any) => Array.isArray(th.variants) && th.variants.length > 0),
    }))
    .filter((item: any) => Array.isArray(item.thicknesses) && item.thicknesses.length > 0);

  if (!filtered.length) {
    console.log('[SRV] No in-stock records matched. Tips:', [
      '• Remove SPB or dims to broaden.',
      '• Check spelling/normalization (أبيض vs ابيض).',
    ]);
  }


  return filtered;
}







// ========= Helpers (add/replace these) =========

// Arabic normalize (keep yours or use this identical version)


/** Your existing parseDims(dims?: string) can stay as-is. */

/** NEW: extract dims/SPB from *any free text* (e.g. `q`).
 * Supports: "225*321", "225×321", "225 * 321", optional "-025"/"-25" → SPB → type:'box'
 */
private parseDimsFromAny(input?: string) {
  if (!input) return {};
  const norm = String(input).trim().replace(/[×xX]/g, '*');
  const m = norm.match(/(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)(?:\s*-\s*0*?(\d+))?/);
  if (!m) return {};
  const length = Number(m[1]);
  const width  = Number(m[2]);
  let spb: number | undefined;
  if (m[3] != null) {
    const v = Number(m[3]);
    if (Number.isFinite(v) && v > 0) spb = v;
  }
  return spb ? { length, width, spb, type: 'box' as const } : { length, width };
}

// ========= Flat search QB (variant → thickness → item) =========
private baseQBForVariantModal() {
  return this.itemVariantRepository
    .createQueryBuilder('variant')
    .innerJoinAndSelect('variant.thickness', 'thickness')
    .innerJoinAndSelect('thickness.item', 'item')
    .leftJoin('variant.itemNameDescription', 'variantDescription')
    .select([
      'variant.id',
      'variant.length',
      'variant.width',
      'variant.sheetsPerBox',
      'variant.origin',
      'variant.itemNameDescriptionId',
      'thickness.id',
      'thickness.thickness',
      'item.id',
      'item.itemName',
      'item.type',
    ]);
}

/** ========== FLAT SEARCH API for /variant-search ========== */
async searchVariantsForModalPOS(params: {
  q?: string;
  dims?: string;
  length?: number;
  width?: number;
  spb?: number;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  page?: number;
  limit?: number;
}) {
  const page  = Math.max(1, Number(params.page ?? 1));
  const limit = Math.min(500, Math.max(1, Number(params.limit ?? 100)));
  const skip  = (page - 1) * limit;

  // Thickness + name from q (order-agnostic)
  const { thickness, cleanName, nmNorm } = this.parseThicknessFromQ(params.q || '');

  // Dims from explicit param OR q text
  const fromDimsParam = this.parseDims(params.dims);
  const fromQ         = this.parseDimsFromAny(params.q);

  // Precedence: explicit params > dims param > q-derived
  const length = params.length ?? fromDimsParam.length ?? (fromQ as any).length;
  const width  = params.width  ?? fromDimsParam.width  ?? (fromQ as any).width;
  const spb    = params.spb    ?? fromDimsParam.spb    ?? (fromQ as any).spb;
  let   type   = params.type   ?? (fromDimsParam as any).type ?? (fromQ as any).type;

  // If SPB exists and no type provided, infer box
  if (spb != null && !type) type = 'box';

  const qb = this.baseQBForVariantModal();

  // name (Arabic-normalized OR raw)
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
  if (type) qb.andWhere('item.type = :tp', { tp: type });

  // Thickness tolerance ±0.011
  if (typeof thickness === 'number' && !Number.isNaN(thickness)) {
    qb.andWhere('ABS(CAST(thickness.thickness AS DECIMAL(10,3)) - :th) < :thTol', {
      th: thickness, thTol: 0.011,
    });
  }

  // Dims tolerance ±0.51 with swap
  const tol = 0.51;
  const hasLen = typeof length === 'number' && Number.isFinite(Number(length));
  const hasWid = typeof width  === 'number' && Number.isFinite(Number(width));

  if (hasLen && hasWid) {
    qb.andWhere(
      `(
        (ABS(CAST(variant.length AS DECIMAL(10,3)) - :len) < :tol AND ABS(CAST(variant.width AS DECIMAL(10,3)) - :wid) < :tol)
        OR
        (ABS(CAST(variant.length AS DECIMAL(10,3)) - :wid) < :tol AND ABS(CAST(variant.width AS DECIMAL(10,3)) - :len) < :tol)
      )`,
      { len: Number(length), wid: Number(width), tol },
    );
  } else if (hasLen) {
    qb.andWhere('ABS(CAST(variant.length AS DECIMAL(10,3)) - :len) < :tol', { len: Number(length), tol });
  } else if (hasWid) {
    qb.andWhere('ABS(CAST(variant.width AS DECIMAL(10,3)) - :wid) < :tol', { wid: Number(width), tol });
  }

  // SPB exact
  if (typeof spb === 'number' && Number.isFinite(Number(spb))) {
    qb.andWhere('variant.sheetsPerBox = :spb', { spb: Number(spb) });
  }

  qb
    .orderBy('item.itemName', 'ASC')
    .addOrderBy('thickness.thickness', 'ASC')
    .addOrderBy('variant.id', 'ASC')
    .skip(skip)
    .take(limit);

  const [entities, totalRows] = await qb.getManyAndCount();

  // Flatten to rows your React mapper expects
  const data = entities.map((v: any) => ({
    variantId: Number(v.id),
    itemId: Number(v.thickness.item.id),
    itemName: String(v.thickness.item.itemName),
    type: String(v.thickness.item.type),
    thicknessId: Number(v.thickness.id),
    thickness: Number(v.thickness.thickness),
    length: Number(v.length),
    width: Number(v.width),
    sheetsPerBox: Number(v.sheetsPerBox),
    origin: v.origin ?? null,
    itemNameDescriptionId: v.itemNameDescriptionId ?? null,
  }));

  return {
    page,
    limit,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / limit)),
    hasMore: page * limit < totalRows,
    data,
  };
}



}


