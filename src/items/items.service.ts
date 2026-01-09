import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Item } from '../entities/inventory/item.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';
import { DataSource, In } from 'typeorm';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
  // items.service.ts (add these imports at top if missing)
import { RealDescription } from '../entities/inventory/itemNameRealDescription.entity';



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
    @InjectRepository(ItemBatch)
    private readonly itemBatchRepository: Repository<ItemBatch>,
private readonly ds: DataSource,
    @InjectRepository(ItemNameDescription)
    private readonly itemNameDescriptionRepository: Repository<ItemNameDescription>,


        @InjectRepository(RealDescription)
    private readonly realDescriptionRepository: Repository<RealDescription>,
private readonly dataSource: DataSource
    
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

// using Real Description
async getSelectedItemDetailsPaginated(opts?: {
  page?: number;
  limit?: number;
  includeEmpty?: boolean; // ignored
}) {
  const page  = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));

  // --- Pull everything we need: variant + thickness + item + realDescription
  const qb = this.itemVariantRepository
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoinAndSelect('v.realDescription', 'rd')
    .select([
      // Variant
      'v.id',
      'v.length',
      'v.width',
      'v.sheetsPerBox',
      'v.origin',

      // Thickness (for ordering)
      't.id',
      't.thickness',

      // Item (useful for UI labels; not used for ordering)
      'i.id',
      'i.itemName',
      'i.type',

      // RealDescription (group key + labels + sort index)
      'rd.id',
      'rd.itemNumber',
      'rd.categoryName',
      'rd.subCategory',
      'rd.colorName',
      'rd.designName',
      'rd.sort_index_real_description',
    ])

    // ✅ Only rows where realDescription exists
    .andWhere('rd.id IS NOT NULL')

    // ---- Order at SQL so groups and their variants come pre-sorted ----
    // 1) RealDescription groups by sort_index_real_description ASC, NULLS LAST
    .addSelect('CASE WHEN rd.sort_index_real_description IS NULL THEN 1 ELSE 0 END', 'rd_nulls')
    .orderBy('rd_nulls', 'ASC')
    .addOrderBy('rd.sort_index_real_description', 'ASC')
    .addOrderBy('rd.id', 'ASC') // stable

    // 2) Inside each description group: by thickness ASC then length ASC
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.id', 'ASC'); // stable tie-breaker

  const rows = await qb.getMany();

  // ---- Group rows by RealDescription ----
  type RDKey = number | 'null';
  const groupsMap = new Map<RDKey, {
    realDescription: {
      id: number | null,
      itemNumber: string | null,
      categoryName: string | null,
      subCategory: string | null,
      colorName: string | null,
      designName: string | null,
      sortIndexRealDescription: number | null,
    },
    variants: any[],
  }>();

  for (const v of rows) {
    const rd = (v as any).realDescription || null;
    const key: RDKey = rd?.id ?? 'null';

    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        realDescription: {
          id: rd?.id ?? null,
          itemNumber: rd?.itemNumber ?? null,
          categoryName: rd?.categoryName ?? null,
          subCategory: rd?.subCategory ?? null,
          colorName: rd?.colorName ?? null,
          designName: rd?.designName ?? null,
          sortIndexRealDescription: rd?.sort_index_real_description ?? null,
        },
        variants: [],
      });
    }

    const grp = groupsMap.get(key)!;

    grp.variants.push({
      variantId: v.id,
      length: v.length,
      width: v.width,
      sheetsPerBox: v.sheetsPerBox,
      origin: v.origin,

      thicknessId: v.thickness.id,
      thickness: v.thickness.thickness,

      itemId: v.thickness.item.id,
      itemName: v.thickness.item.itemName,
      type: v.thickness.item.type,
    });
  }

  // ---- Materialize, keep SQL order (already ordered by RD then thickness then length) ----
  const allGroups = Array.from(groupsMap.values());

  // ---- Pagination over description groups ----
  const totalGroups = allGroups.length;
  const start = (page - 1) * limit;
  const end   = start + limit;
  const pageGroups = allGroups.slice(start, end);

  return {
    page,
    limit,
    hasMore: end < totalGroups,
    totalGroups,
    data: pageGroups,
  };
}


// using item naem description

async getSelectedItemDetailsByNamePaginated(opts?: {
  page?: number;
  limit?: number;
  includeEmpty?: boolean; // currently ignored, like in v1
}) {
  const page  = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));

  // --- Pull everything we need: variant + thickness + item + itemNameDescription
  const qb = this.itemVariantRepository
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoinAndSelect('v.itemNameDescription', 'd')
    .select([
      // Variant
      'v.id',
      'v.length',
      'v.width',
      'v.sheetsPerBox',
      'v.origin',

      // Thickness
      't.id',
      't.thickness',
      't.sort_index',

      // Item
      'i.id',
      'i.itemName',
      'i.type',
      'i.sortIndex',

      // ItemNameDescription (group key + labels + sort index)
      'd.id',
      'd.itemNumber',
      'd.categoryName',
      'd.subCategory',
      'd.colorName',
      'd.designName',
      'd.sort_index_description',
    ])

    // ✅ Only rows where ItemNameDescription exists
    .andWhere('d.id IS NOT NULL')

    // ---- Order in SQL so groups and their variants come pre-sorted ----
    // 1) Description groups: sort_index_description ASC, NULLS LAST
    .addSelect(
      'CASE WHEN d.sort_index_description IS NULL THEN 1 ELSE 0 END',
      'd_nulls',
    )
    .orderBy('d_nulls', 'ASC')
    .addOrderBy('d.sort_index_description', 'ASC')
    .addOrderBy('d.id', 'ASC') // stable

    // 2) Inside each description group:
    //    optionally by Item.sortIndex, then thickness, then length
    .addOrderBy('i.sortIndex', 'ASC')
    .addOrderBy('t.sort_index', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.id', 'ASC'); // stable tie-breaker

  const rows = await qb.getMany();

  // ---- Group rows by ItemNameDescription ----
  type DescKey = number | 'null';

  const groupsMap = new Map<
    DescKey,
    {
      description: {
        id: number | null;
        itemNumber: string | null;
        categoryName: string | null;
        subCategory: string | null;
        colorName: string | null;
        designName: string | null;
        sortIndexDescription: number | null;
      };
      variants: any[];
    }
  >();

  for (const v of rows) {
    const d = (v as any).itemNameDescription || null;
    const key: DescKey = d?.id ?? 'null';

    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        description: {
          id: d?.id ?? null,
          itemNumber: d?.itemNumber ?? null,
          categoryName: d?.categoryName ?? null,
          subCategory: d?.subCategory ?? null,
          colorName: d?.colorName ?? null,
          designName: d?.designName ?? null,
          sortIndexDescription: d?.sort_index_description ?? null,
        },
        variants: [],
      });
    }

    const grp = groupsMap.get(key)!;

    grp.variants.push({
      // Variant basics
      variantId: v.id,
      length: v.length,
      width: v.width,
      sheetsPerBox: v.sheetsPerBox,
      origin: v.origin,

      // Thickness
      thicknessId: v.thickness.id,
      thickness: v.thickness.thickness,

      // Item
      itemId: v.thickness.item.id,
      itemName: v.thickness.item.itemName,
      type: v.thickness.item.type,

      // 🔹 Extra from ItemNameDescription (per-item, as requested)
      itemNumber: d?.itemNumber ?? null,
      subCategory: d?.subCategory ?? null,
    });
  }

  // ---- Materialize, keep SQL order ----
  const allGroups = Array.from(groupsMap.values());

  // ---- Pagination over description groups ----
  const totalGroups = allGroups.length;
  const start = (page - 1) * limit;
  const end   = start + limit;
  const pageGroups = allGroups.slice(start, end);

  return {
    page,
    limit,
    hasMore: end < totalGroups,
    totalGroups,
    data: pageGroups,
  };
}



// using item name description

async getSelectedItemDetailsPaginatedByDescription(opts?: {
  page?: number;
  limit?: number;
  includeEmpty?: boolean; // ignored
}) {
  const page  = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));

  // --- Pull everything we need: variant + thickness + item + itemNameDescription
  const qb = this.itemVariantRepository
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoinAndSelect('v.itemNameDescription', 'd')
    .select([
      // Variant
      'v.id',
      'v.length',
      'v.width',
      'v.sheetsPerBox',
      'v.origin',

      // Thickness (for ordering)
      't.id',
      't.thickness',

      // Item (for UI labels; not used for ordering)
      'i.id',
      'i.itemName',
      'i.type',

      // ItemNameDescription (group key + labels + sort index)
      'd.id',
      'd.itemNumber',
      'd.categoryName',
      'd.subCategory',
      'd.colorName',
      'd.designName',
      'd.sort_index_description',
    ])

    // ---- Order at SQL so groups and their variants come pre-sorted ----
    // 1) Description groups by sort_index_description ASC, NULLS LAST
    .addSelect('CASE WHEN d.sort_index_description IS NULL THEN 1 ELSE 0 END', 'd_nulls')
    .orderBy('d_nulls', 'ASC')
    .addOrderBy('d.sort_index_description', 'ASC')
    .addOrderBy('d.id', 'ASC') // stable

    // 2) Inside each description group: by thickness ASC then length ASC
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.id', 'ASC'); // stable tie-breaker

  const rows = await qb.getMany();

  // ---- Group rows by ItemNameDescription ----
  type DescKey = number | 'null';
  const groupsMap = new Map<DescKey, {
    itemNameDescription: {
      id: number | null,
      itemNumber: string | null,
      categoryName: string | null,
      subCategory: string | null,
      colorName: string | null,
      designName: string | null,
      sortIndexDescription: number | null,
    },
    variants: Array<{
      variantId: number;
      length: any;
      width: any;
      sheetsPerBox: number;
      origin: string;

      thicknessId: number;
      thickness: any;

      itemId: number;
      itemName: string;
      type: string;
    }>,
  }>();

  for (const v of rows) {
    const d = (v as any).itemNameDescription || null;
    const key: DescKey = d?.id ?? 'null';

    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        itemNameDescription: {
          id: d?.id ?? null,
          itemNumber: d?.itemNumber ?? null,
          categoryName: d?.categoryName ?? null,
          subCategory: d?.subCategory ?? null,
          colorName: d?.colorName ?? null,
          designName: d?.designName ?? null,
          sortIndexDescription: d?.sort_index_description ?? null,
        },
        variants: [],
      });
    }

    const grp = groupsMap.get(key)!;

    grp.variants.push({
      variantId: v.id,
      length: v.length,
      width: v.width,
      sheetsPerBox: v.sheetsPerBox,
      origin: v.origin,

      thicknessId: v.thickness.id,
      thickness: v.thickness.thickness,

      itemId: v.thickness.item.id,
      itemName: v.thickness.item.itemName,
      type: v.thickness.item.type,
    });
  }

  // ---- Materialize, keep SQL order (already ordered by desc then thickness then length) ----
  const allGroups = Array.from(groupsMap.values());

  // ---- Pagination over description groups ----
  const totalGroups = allGroups.length;
  const start = (page - 1) * limit;
  const end   = start + limit;
  const pageGroups = allGroups.slice(start, end);

  return {
    page,
    limit,
    hasMore: end < totalGroups,
    totalGroups,
    data: pageGroups,
  };
}







async createFullItem(data: {
  itemName: string;
  type: 'box' | 'sheet' | 'sqm' | 'unit'; // ✅ added unit
  stockMode?: 'SQM' | 'QTY' | 'NONE';     // ✅ added stockMode
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

  // ✅ NEW: choose stock mode (default: glass=SQM, unit=QTY)
  const stockMode: 'SQM' | 'QTY' | 'NONE' =
    data.stockMode ?? (type === 'unit' ? 'QTY' : 'SQM');

  // ──────────────────────────────────────────────
  // Normalization helpers
  // ──────────────────────────────────────────────
  const normalizeDigits = (s: string) => {
    if (!s) return '';
    const map: Record<string, string> = {
      // Arabic-Indic
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
      // Extended Arabic-Indic
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    };
    return String(s).replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
  };

  const normalizeText = (s: string) => {
    if (s == null) return '';
    const unified = String(s)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ');
    const trimmed = unified.trim();
    return normalizeDigits(trimmed);
  };

  // ──────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────
  const toNum = (v: any, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  // Fingerprint prefers itemNameDescription.id; falls back to realDescription.id
  const fpOf = (args: {
    thickness: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string;
    keyDescId: number | null;
  }) =>
    [
      args.thickness,
      args.length,
      args.width,
      args.sheetsPerBox,
      (args.origin ?? '').trim(),
      args.keyDescId ?? 'null',
    ].join('|');

  // Normalize incoming thickness/variants for target type
  const normalizeForType = (targetType: 'box' | 'sheet' | 'sqm') => {
    return (rawTh ?? []).map((th) => ({
      thickness: toNum(th.thickness),
      variants: Array.isArray(th.variants)
        ? th.variants.map((v: any) => {
            const baseLen = toNum(v?.length);
            const baseWid = toNum(v?.width);
            const baseSheets =
              targetType === 'sheet'
                ? 1
                : targetType === 'sqm'
                ? 0
                : toNum(v?.sheetsPerBox);

            return {
              length: targetType === 'sqm' ? 0 : baseLen,
              width:  targetType === 'sqm' ? 0 : baseWid,
              sheetsPerBox: baseSheets,
              origin: targetType === 'sqm' ? '' : String(v?.origin ?? ''),
              fixBox: !!v?.fixBox,
              fixLength: !!v?.fixLength,
              fixWidth: !!v?.fixWidth,
            };
          })
        : [],
    }));
  };

  // ✅ NEW: for unit (because your variant columns are NOT NULL)
  const buildUnitIncomingForRequested = () => [
    {
      thickness: 0,
      variants: [
        {
          length: 0,
          width: 0,
          sheetsPerBox: 1,
          origin: '-', // required
          fixBox: false,
          fixLength: false,
          fixWidth: false,
        },
      ],
    },
  ];

  // Resolve/create BOTH descriptions from one descriptor
  const resolveOrCreatePair = async (desc: {
    itemNumber: string;
    categoryName: string;
    subCategory: string;
    colorName: string;
    designName: string;
  }): Promise<{ nameDesc: any; realDesc: any; isNewName: boolean; isNewReal: boolean }> => {
    const whereNorm = {
      itemNumber:  normalizeText(desc.itemNumber ?? ''),
      categoryName: normalizeText(desc.categoryName ?? ''),
      subCategory:  normalizeText(desc.subCategory ?? ''),
      colorName:    normalizeText(desc.colorName ?? ''),
      designName:   normalizeText(desc.designName ?? ''),
    };

    // Name
    let nameDesc = await this.itemNameDescriptionRepository.findOne({ where: whereNorm });
    let isNewName = false;
    if (!nameDesc) {
      nameDesc = this.itemNameDescriptionRepository.create(whereNorm);
      nameDesc = await this.itemNameDescriptionRepository.save(nameDesc);
      isNewName = true;
    }

    // Real
    let realDesc = await this.realDescriptionRepository.findOne({ where: whereNorm });
    let isNewReal = false;
    if (!realDesc) {
      realDesc = this.realDescriptionRepository.create(whereNorm);
      realDesc = await this.realDescriptionRepository.save(realDesc);
      isNewReal = true;
    }

    return { nameDesc, realDesc, isNewName, isNewReal };
  };

  /**
   * Upsert item of a specific type.
   * Returns: the item + a map of thickness -> newly created variant fingerprints.
   * Each variant is saved with BOTH itemNameDescription and realDescription set.
   */
  const upsertItemWith = async (
    targetType: 'box' | 'sheet' | 'sqm' | 'unit', // ✅ added unit
    incoming: Array<{
      thickness: number;
      variants: Array<{
        length: number;
        width: number;
        sheetsPerBox: number;
        origin: string;
        fixBox: boolean;
        fixLength: boolean;
        fixWidth: boolean;
      }>;
    }>,
    pairs: Array<{ nameDesc: any; realDesc: any }>,
  ): Promise<{
    item: Item;
    createdByThickness: Map<number, string[]>;
  }> => {
    let item = await this.itemRepository.findOne({
      where: { itemName, type: targetType },
      relations: [
        'thicknesses',
        'thicknesses.variants',
        'thicknesses.variants.itemNameDescription',
        'thicknesses.variants.realDescription',
      ],
    });

    const createdByThickness = new Map<number, string[]>();

    if (!item) {
      // ✅ NEW: save stockMode too
      item = this.itemRepository.create({ itemName, type: targetType, stockMode });
      item = await this.itemRepository.save(item);
      item.thicknesses = [];

      for (const thDto of incoming) {
        const thEnt = this.thicknessRepository.create({ thickness: thDto.thickness, item });

        thEnt.variants = thDto.variants.map((vDto, idx) => {
          const pair = pairs[idx] ?? null;
          const nameDesc = pair?.nameDesc ?? null;
          const realDesc = pair?.realDesc ?? null;

          return this.itemVariantRepository.create({
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            fixBox: vDto.fixBox,
            fixLength: vDto.fixLength,
            fixWidth: vDto.fixWidth,
            itemNameDescription: nameDesc ?? undefined,
            realDescription: realDesc ?? undefined,
          });
        });

        const savedTh = await this.thicknessRepository.save(thEnt);
        item.thicknesses.push(savedTh);

        const fps = thDto.variants.map((vDto, idx) => {
          const pair = pairs[idx] ?? null;
          const keyDescId = pair?.nameDesc?.id ?? pair?.realDesc?.id ?? null;
          return fpOf({
            thickness: thDto.thickness,
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            keyDescId,
          });
        });
        createdByThickness.set(thDto.thickness, fps);
      }

      return { item, createdByThickness };
    }

    // ✅ NEW: keep stockMode in sync (doesn't change your upsert rules)
    if ((item as any).stockMode !== stockMode) {
      (item as any).stockMode = stockMode;
      await this.itemRepository.save(item);
    }

    // Existing item → idempotent upsert
    for (const thDto of incoming) {
      let thEnt =
        item.thicknesses?.find((t) => Number(t.thickness) === Number(thDto.thickness)) ?? null;

      if (!thEnt) {
        thEnt = this.thicknessRepository.create({ thickness: thDto.thickness, item });
        thEnt = await this.thicknessRepository.save(thEnt);
        item.thicknesses.push(thEnt);
      }

      thEnt.variants = thEnt.variants || [];
      const existing = new Set(
        (thEnt.variants || []).map((v) => {
          const keyDescId = v.itemNameDescription?.id ?? v.realDescription?.id ?? null;
          return fpOf({
            thickness: Number(thDto.thickness),
            length: Number(v.length),
            width: Number(v.width),
            sheetsPerBox: Number(v.sheetsPerBox),
            origin: v.origin ?? '',
            keyDescId,
          });
        }),
      );

      const createdFps: string[] = [];

      for (let i = 0; i < thDto.variants.length; i++) {
        const vDto = thDto.variants[i];
        const pair = pairs[i] ?? null;
        const nameDesc = pair?.nameDesc ?? null;
        const realDesc = pair?.realDesc ?? null;

        const keyDescId = nameDesc?.id ?? realDesc?.id ?? null;
        const fp = fpOf({
          thickness: Number(thDto.thickness),
          length: Number(vDto.length),
          width: Number(vDto.width),
          sheetsPerBox: Number(vDto.sheetsPerBox),
          origin: vDto.origin ?? '',
          keyDescId,
        });

        if (existing.has(fp)) continue;

        const newVar = this.itemVariantRepository.create({
          length: vDto.length,
          width: vDto.width,
          sheetsPerBox: vDto.sheetsPerBox,
          origin: vDto.origin,
          fixBox: vDto.fixBox,
          fixLength: vDto.fixLength,
          fixWidth: vDto.fixWidth,
          thickness: thEnt,
          itemNameDescription: nameDesc ?? undefined,
          realDescription: realDesc ?? undefined,
        });

        await this.itemVariantRepository.save(newVar);
        thEnt.variants.push(newVar);
        existing.add(fp);
        createdFps.push(fp);
      }

      if (createdFps.length > 0) {
        createdByThickness.set(Number(thDto.thickness), createdFps);
      }
    }

    return { item, createdByThickness };
  };

  // Build SQM incoming for ONE pair (one 0x0 variant per thickness)
  const buildSQMIncomingForOnePair = (thicknessValues: number[]) => {
    return thicknessValues.map((th) => ({
      thickness: th,
      variants: [
        {
          length: 0,
          width: 0,
          sheetsPerBox: 0,
          origin: '',
          fixBox: false,
          fixLength: false,
          fixWidth: false,
        },
      ],
    }));
  };

  // ──────────────────────────────────────────────
  // 1) Resolve BOTH descriptions for each descriptor
  // ──────────────────────────────────────────────
  const pairs: Array<{ nameDesc: any; realDesc: any }> = [];
  const newPairsForSQM: Array<{ nameDesc: any; realDesc: any }> = [];
  for (const d of descriptions) {
    const pair = await resolveOrCreatePair(d);
    pairs.push({ nameDesc: pair.nameDesc, realDesc: pair.realDesc });
    if (pair.isNewName || pair.isNewReal) {
      newPairsForSQM.push({ nameDesc: pair.nameDesc, realDesc: pair.realDesc });
    }
  }

  // unique thickness list
  const uniqueThicknesses = Array.from(
    new Set((rawTh ?? []).map((t) => toNum(t.thickness))).values(),
  ).filter((n) => Number.isFinite(n));

  // ──────────────────────────────────────────────
  // 2) Upsert the requested item TYPE (main)
  // ──────────────────────────────────────────────
  // ✅ NEW: unit gets a default thickness+variant so NOT NULL columns are satisfied
  const incomingForRequested =
    type === 'unit' ? buildUnitIncomingForRequested() : normalizeForType(type);

  const { item: mainItem, createdByThickness } = await upsertItemWith(
    type,
    incomingForRequested,
    pairs,
  );

  // ──────────────────────────────────────────────
  // 3) If 'box' → mirror ONLY the newly created variants to 'sheet'
  //    (FIXED: candidate key now keeps the same description id)
  // ──────────────────────────────────────────────
  if (type === 'box') {
    type MirrorVariant = {
      length: number;
      width: number;
      sheetsPerBox: number;
      origin: string;
      fixBox: boolean;
      fixLength: boolean;
      fixWidth: boolean;
    };
    type MirrorPayload = Array<{ thickness: number; variants: MirrorVariant[] }>;

    const createdOnlyForSheet: MirrorPayload = incomingForRequested
      .map((th) => {
        const createdFps = createdByThickness.get(Number(th.thickness)) || [];
        if (createdFps.length === 0) return null;

        // Drop sheetsPerBox element (index 3) when comparing
        const keyWithoutSpb = (s: string) =>
          s
            .split('|')
            .map((x, i) => (i === 4 ? x.trim() : x)) // normalize origin space
            .filter((_, i) => i !== 3)                // drop SPB
            .join('|');

        const createdNoSpb = new Set(createdFps.map(keyWithoutSpb));

        const filteredVariants: MirrorVariant[] = th.variants
          .map((v, idx) => {
            const pair = pairs[idx] ?? null;
            const keyDescId = pair?.nameDesc?.id ?? pair?.realDesc?.id ?? null;

            const candidateNoSpb = keyWithoutSpb(
              [
                th.thickness,
                v.length,
                v.width,
                0,                          // dropped in comparator
                v.origin ?? '',
                keyDescId ?? 'null',        // ✅ include same desc id
              ].join('|'),
            );

            if (!createdNoSpb.has(candidateNoSpb)) return null;

            return {
              length: Number(v.length),
              width: Number(v.width),
              sheetsPerBox: 1,             // SHEET uses 1
              origin: v.origin ?? '',
              fixBox: !!v.fixBox,
              fixLength: !!v.fixLength,
              fixWidth: !!v.fixWidth,
            };
          })
          .filter((x): x is MirrorVariant => Boolean(x));

        if (filteredVariants.length === 0) return null;

        return { thickness: Number(th.thickness), variants: filteredVariants };
      })
      .filter((x): x is MirrorPayload[number] => Boolean(x));

    if (createdOnlyForSheet.length > 0) {
      await upsertItemWith('sheet', createdOnlyForSheet, pairs);
    }
  }

  // ──────────────────────────────────────────────
  // 4) SQM for NEW pairs (one 0x0 variant per thickness)
  // ──────────────────────────────────────────────
  // ✅ NEW: unit items should NOT create sqm mirrors
  if (type !== 'unit' && newPairsForSQM.length > 0 && uniqueThicknesses.length > 0) {
    const sqmIncoming = buildSQMIncomingForOnePair(uniqueThicknesses);
    for (const pair of newPairsForSQM) {
      await upsertItemWith('sqm', sqmIncoming, [pair]);
    }
  }

  return mainItem;
}




async createFullItemUsingRealDescription(data: {
  itemName: string;
  type: 'box' | 'sheet' | 'sqm' | 'unit'; // ✅ extended (no logic change)
  stockMode?: 'SQM' | 'QTY' | 'NONE';     // ✅ NEW
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

  // ✅ NEW: decide stock mode (glass defaults to SQM, unit defaults to QTY)
  const stockMode: 'SQM' | 'QTY' | 'NONE' =
    data.stockMode ?? (type === 'unit' ? 'QTY' : 'SQM');

  // ── Helpers ─────────────────────────────────────────────────────────
  const normalizeDigits = (s: string) => {
    if (!s) return '';
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    };
    return String(s).replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
  };

  const normalizeText = (s: string) => {
    if (s == null) return '';
    const unified = String(s)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ');
    const trimmed = unified.trim();
    return normalizeDigits(trimmed);
  };

  const toNum = (v: any, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  // fingerprint uses ONLY the real side id for this flow
  const fpOf = (args: {
    thickness: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string;
    realDescId: number | null;
  }) =>
    [
      args.thickness,
      args.length,
      args.width,
      args.sheetsPerBox,
      (args.origin ?? '').trim(),
      args.realDescId ?? 'null',
    ].join('|');

  const normalizeForType = (targetType: 'box' | 'sheet' | 'sqm') =>
    (rawTh ?? []).map((th) => ({
      thickness: toNum(th.thickness),
      variants: Array.isArray(th.variants)
        ? th.variants.map((v: any) => {
            const baseLen = toNum(v?.length);
            const baseWid = toNum(v?.width);
            const baseSheets =
              targetType === 'sheet' ? 1
              : targetType === 'sqm' ? 0
              : toNum(v?.sheetsPerBox);

            return {
              length: targetType === 'sqm' ? 0 : baseLen,
              width:  targetType === 'sqm' ? 0 : baseWid,
              sheetsPerBox: baseSheets,
              origin: targetType === 'sqm' ? '' : String(v?.origin ?? ''),
              fixBox: !!v?.fixBox,
              fixLength: !!v?.fixLength,
              fixWidth: !!v?.fixWidth,
            };
          })
        : [],
    }));

  // ✅ NEW: unit payload (because your Variant columns are NOT NULL)
  const buildUnitIncoming = () => [
    {
      thickness: 0,
      variants: [
        {
          length: 0,
          width: 0,
          sheetsPerBox: 1,
          origin: '-', // required
          fixBox: false,
          fixLength: false,
          fixWidth: false,
        },
      ],
    },
  ];

  // Only REAL description is resolved/created here
  const resolveOrCreateReal = async (desc: {
    itemNumber: string;
    categoryName: string;
    subCategory: string;
    colorName: string;
    designName: string;
  }): Promise<{ realDesc: RealDescription; isNew: boolean }> => {
    const where = {
      itemNumber:  normalizeText(desc.itemNumber ?? ''),
      categoryName: normalizeText(desc.categoryName ?? ''),
      subCategory:  normalizeText(desc.subCategory ?? ''),
      colorName:    normalizeText(desc.colorName ?? ''),
      designName:   normalizeText(desc.designName ?? ''),
    };
    let ent = await this.realDescriptionRepository.findOne({ where });
    if (!ent) {
      ent = this.realDescriptionRepository.create(where);
      ent = await this.realDescriptionRepository.save(ent);
      return { realDesc: ent, isNew: true };
    }
    return { realDesc: ent, isNew: false };
  };

  // Upsert with ONLY realDescription set; itemNameDescription is NULL
  const upsertItemWith = async (
    targetType: 'box' | 'sheet' | 'sqm' | 'unit', // ✅ extended
    incoming: Array<{
      thickness: number;
      variants: Array<{
        length: number;
        width: number;
        sheetsPerBox: number;
        origin: string;
        fixBox: boolean;
        fixLength: boolean;
        fixWidth: boolean;
      }>;
    }>,
    realDescs: RealDescription[]
  ): Promise<{ item: Item; createdByThickness: Map<number, string[]> }> => {
    let item = await this.itemRepository.findOne({
      where: { itemName, type: targetType },
      relations: [
        'thicknesses',
        'thicknesses.variants',
        'thicknesses.variants.itemNameDescription',
        'thicknesses.variants.realDescription',
      ],
    });

    const createdByThickness = new Map<number, string[]>();

    if (!item) {
      // ✅ NEW: save stockMode too
      item = await this.itemRepository.save(
        this.itemRepository.create({ itemName, type: targetType, stockMode })
      );
      item.thicknesses = [];

      for (const thDto of incoming) {
        const thEnt = this.thicknessRepository.create({ thickness: thDto.thickness, item });

        thEnt.variants = thDto.variants.map((vDto, idx) =>
          this.itemVariantRepository.create({
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            fixBox: vDto.fixBox,
            fixLength: vDto.fixLength,
            fixWidth: vDto.fixWidth,
            itemNameDescription: null, // <-- keep item-name side NULL
            realDescription: realDescs[idx] ?? undefined,
          })
        );

        const savedTh = await this.thicknessRepository.save(thEnt);
        item.thicknesses.push(savedTh);

        const fps = thDto.variants.map((vDto, idx) =>
          fpOf({
            thickness: thDto.thickness,
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            realDescId: realDescs[idx]?.id ?? null,
          })
        );
        createdByThickness.set(thDto.thickness, fps);
      }

      return { item, createdByThickness };
    }

    // ✅ NEW: keep stockMode in sync (no change to your existing upsert logic)
    if ((item as any).stockMode !== stockMode) {
      (item as any).stockMode = stockMode;
      await this.itemRepository.save(item);
    }

    // existing item: idempotent upsert
    for (const thDto of incoming) {
      let thEnt = item.thicknesses?.find((t) => Number(t.thickness) === Number(thDto.thickness)) ?? null;
      if (!thEnt) {
        thEnt = await this.thicknessRepository.save(
          this.thicknessRepository.create({ thickness: thDto.thickness, item })
        );
        item.thicknesses.push(thEnt);
      }

      thEnt.variants = thEnt.variants || [];
      const existing = new Set(
        (thEnt.variants || []).map((v) =>
          fpOf({
            thickness: Number(thDto.thickness),
            length: Number(v.length),
            width: Number(v.width),
            sheetsPerBox: Number(v.sheetsPerBox),
            origin: v.origin ?? '',
            realDescId: v.realDescription?.id ?? null, // only check real side
          })
        )
      );

      const createdFps: string[] = [];

      for (let i = 0; i < thDto.variants.length; i++) {
        const vDto = thDto.variants[i];
        const realDesc = realDescs[i] ?? null;

        const fp = fpOf({
          thickness: Number(thDto.thickness),
          length: Number(vDto.length),
          width: Number(vDto.width),
          sheetsPerBox: Number(vDto.sheetsPerBox),
          origin: vDto.origin ?? '',
          realDescId: realDesc?.id ?? null,
        });

        if (existing.has(fp)) continue;

        const newVar = this.itemVariantRepository.create({
          length: vDto.length,
          width: vDto.width,
          sheetsPerBox: vDto.sheetsPerBox,
          origin: vDto.origin,
          fixBox: vDto.fixBox,
          fixLength: vDto.fixLength,
          fixWidth: vDto.fixWidth,
          thickness: thEnt,
          itemNameDescription: null, // <-- keep item-name side NULL
          realDescription: realDesc ?? undefined,
        });

        await this.itemVariantRepository.save(newVar);
        thEnt.variants.push(newVar);
        existing.add(fp);
        createdFps.push(fp);
      }

      if (createdFps.length > 0) {
        createdByThickness.set(Number(thDto.thickness), createdFps);
      }
    }

    return { item, createdByThickness };
  };

  const buildSQMIncoming = (thVals: number[]) =>
    thVals.map((th) => ({
      thickness: th,
      variants: [
        {
          length: 0,
          width: 0,
          sheetsPerBox: 0,
          origin: '',
          fixBox: false,
          fixLength: false,
          fixWidth: false,
        },
      ],
    }));

  // ── 1) Resolve ONLY real descriptions ──────────────────────────────
  const realDescs: RealDescription[] = [];
  const newRealDescs: RealDescription[] = [];
  for (const d of descriptions) {
    const { realDesc, isNew } = await resolveOrCreateReal(d);
    realDescs.push(realDesc);
    if (isNew) newRealDescs.push(realDesc);
  }

  const uniqueThicknesses = Array.from(
    new Set((rawTh ?? []).map((t) => toNum(t.thickness))).values()
  ).filter((n) => Number.isFinite(n));

  // ── 2) Upsert main (only real side) ────────────────────────────────
  // ✅ NEW: if unit => create a default thickness+variant; otherwise keep your exact logic
  const incomingForRequested =
    type === 'unit' ? buildUnitIncoming() : normalizeForType(type);

  const { item: mainItem, createdByThickness } = await upsertItemWith(
    type,
    incomingForRequested,
    realDescs
  );

  // ── 3) Mirror box → sheet (new only), using REAL desc id in the key ─
  if (type === 'box') {
    type MirrorVariant = {
      length: number;
      width: number;
      sheetsPerBox: number;
      origin: string;
      fixBox: boolean;
      fixLength: boolean;
      fixWidth: boolean;
    };
    type MirrorPayload = Array<{ thickness: number; variants: MirrorVariant[] }>;

    const createdOnlyForSheet: MirrorPayload = incomingForRequested
      .map((th) => {
        const createdFps = createdByThickness.get(Number(th.thickness)) || [];
        if (createdFps.length === 0) return null;

        const keyWithoutSpb = (s: string) =>
          s
            .split('|')
            .map((x, i) => (i === 4 ? x.trim() : x))
            .filter((_, i) => i !== 3)
            .join('|');

        const createdNoSpb = new Set(createdFps.map(keyWithoutSpb));

        const filteredVariants: MirrorVariant[] = th.variants
          .map((v, idx) => {
            const realDescId = realDescs[idx]?.id ?? null;
            const candidateNoSpb = keyWithoutSpb(
              [
                th.thickness,
                v.length,
                v.width,
                0,
                v.origin ?? '',
                realDescId ?? 'null',
              ].join('|')
            );
            if (!createdNoSpb.has(candidateNoSpb)) return null;

            return {
              length: Number(v.length),
              width: Number(v.width),
              sheetsPerBox: 1,
              origin: v.origin ?? '',
              fixBox: !!v.fixBox,
              fixLength: !!v.fixLength,
              fixWidth: !!v.fixWidth,
            };
          })
          .filter(Boolean) as MirrorVariant[];

        if (filteredVariants.length === 0) return null;

        return { thickness: Number(th.thickness), variants: filteredVariants };
      })
      .filter(Boolean) as MirrorPayload;

    if (createdOnlyForSheet.length > 0) {
      await upsertItemWith('sheet', createdOnlyForSheet, realDescs);
    }
  }

  // ── 4) SQM for NEW real descriptions ONLY ──────────────────────────
  // ✅ NEW: skip this for unit items (no change to glass behavior)
  if (type !== 'unit' && newRealDescs.length > 0 && uniqueThicknesses.length > 0) {
    const sqmIncoming = buildSQMIncoming(uniqueThicknesses);
    for (const rd of newRealDescs) {
      await upsertItemWith('sqm', sqmIncoming, [rd]);
    }
  }

  return mainItem;
}





// items.service.ts (inside ItemsService)

private safeJson(obj: any, max = 4000) {
  try {
    const s = JSON.stringify(
      obj,
      (_k, v) => {
        if (Array.isArray(v)) return v.length > 50 ? `[Array(${v.length})]` : v;
        return v;
      }
    );
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '[unserializable]';
  }
}

// using item name description
async editFullItem(editDto: {
  itemId?: number;
  itemName?: string;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  stockMode?: 'SQM' | 'QTY' | 'NONE';
  thicknesses: Array<{
    thicknessId?: number;
    thickness?: number | string;
    variants: Array<{
      id: number;
      length?: number | string;
      width?: number | string;
      sheetsPerBox?: number | string;
      origin?: string;
      fixBox?: boolean;
      fixLength?: boolean;
      fixWidth?: boolean;
      description?: { id?: number } | null;
      realDescription?: { id?: number } | null;
    }>;
  }>;
}): Promise<Item> {
  const toNum = (v: any, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  const normType = (t?: string) =>
    (t === 'box' || t === 'sheet' || t === 'sqm' || t === 'unit') ? t : 'box';

  const tag = (s: string) => `[editFullItem] ${s}`;
  const j = (o: any) => JSON.stringify(o);

  console.log(tag('Incoming DTO:'), j(editDto));

  const { itemId, itemName, type } = editDto;
  const tType = normType(type);

  // 1) Load item with relations
  let item: Item | null = null;
  if (itemId) {
    console.log(tag(`Loading item by id=${itemId} with relations...`));
    item = await this.itemRepository.findOne({
      where: { id: itemId },
      relations: [
        'thicknesses',
        'thicknesses.variants',
        'thicknesses.variants.itemNameDescription',
        'thicknesses.variants.realDescription',
      ],
    });
  } else if (itemName && tType) {
    console.log(tag(`Loading item by (itemName,type)=(${itemName},${tType}) with relations...`));
    item = await this.itemRepository.findOne({
      where: { itemName, type: tType },
      relations: [
        'thicknesses',
        'thicknesses.variants',
        'thicknesses.variants.itemNameDescription',
        'thicknesses.variants.realDescription',
      ],
    });
  }

  if (!item) {
    console.log(tag('ERROR: Item not found for editing'));
    throw new Error('Item to edit not found (provide itemId or (itemName,type)).');
  }

  console.log(
    tag('Loaded item:'),
    j({
      itemId: item.id,
      itemName: item.itemName,
      type: item.type,
      stockMode: (item as any).stockMode ?? null,
      thicknessCount: item.thicknesses?.length ?? 0,
      thicknessIds: (item.thicknesses ?? []).map(t => t.id),
    }),
  );

  // ✅ NEW: Allow updating item name
  if (editDto.itemName && editDto.itemName !== item.itemName) {
    item.itemName = editDto.itemName;
  }

  // Update stockMode
  if (editDto.stockMode && (editDto.stockMode === 'SQM' || editDto.stockMode === 'QTY' || editDto.stockMode === 'NONE')) {
    (item as any).stockMode = editDto.stockMode;
  }

  // Update type
  if (editDto.type && editDto.type !== item.type) {
    item.type = editDto.type as any;
  }

  // Persist item-level changes
  await this.itemRepository.save(item);

  const isSQM = item.type === 'sqm';
  const isUNIT = item.type === 'unit';

  // 2) Build thickness lookups
  const thicknessById = new Map<number, Thickness>();
  const thicknessByVal = new Map<number, Thickness>();
  for (const th of item.thicknesses ?? []) {
    thicknessById.set(th.id, th);
    thicknessByVal.set(Number((th as any).thickness), th);
    th.variants = th.variants ?? [];
  }

  const findThicknessStrict = (incoming: { thicknessId?: number; thickness?: any }) => {
    const fromId = incoming?.thicknessId;
    const fromValNum = toNum(incoming?.thickness);
    console.log(tag('Resolving thickness from incoming:'), j({ fromId, fromVal: fromValNum }));

    if (fromId && thicknessById.has(fromId)) {
      console.log(tag(`Resolved thickness by id=${fromId}`));
      return thicknessById.get(fromId)!;
    }
    if (Number.isFinite(fromValNum) && thicknessByVal.has(fromValNum)) {
      console.log(tag(`Resolved thickness by value=${fromValNum}`));
      return thicknessByVal.get(fromValNum);
    }
    console.log(tag('ERROR: Thickness not found on this item'));
    throw new Error(
      `Thickness not found on this item. Provide a valid thicknessId or an existing numeric thickness.`,
    );
  };

  const descCache = new Map<number, any>();
  const getDescById = async (id?: number | null) => {
    if (!id) return null;
    if (descCache.has(id)) return descCache.get(id);
    const ent = await this.itemNameDescriptionRepository.findOne({ where: { id } });
    if (!ent) {
      console.log(tag(`ERROR: Description id ${id} not found.`));
      throw new Error(`Description id ${id} not found.`);
    }
    descCache.set(id, ent);
    return ent;
  };

  const realDescCache = new Map<number, any>();
  const getRealDescById = async (id?: number | null) => {
    if (!id) return null;
    if (realDescCache.has(id)) return realDescCache.get(id);
    const ent = await this.realDescriptionRepository.findOne({ where: { id } });
    if (!ent) {
      console.log(tag(`ERROR: RealDescription id ${id} not found.`));
      throw new Error(`RealDescription id ${id} not found.`);
    }
    realDescCache.set(id, ent);
    return ent;
  };

  // 3) Process thickness edits
  for (const thDto of editDto.thicknesses ?? []) {
    console.log(tag('Incoming thickness DTO:'), j(thDto));
    
    let thEnt: Thickness | null | undefined = null;
    
    // Try to find existing thickness
    if (thDto.thicknessId) {
      thEnt = findThicknessStrict(thDto);
    }
    
    // ✅ NEW: Allow updating thickness value
    if (thEnt && thDto.thickness !== undefined) {
      const newThicknessValue = toNum(thDto.thickness);
      if (Number.isFinite(newThicknessValue) && newThicknessValue !== Number((thEnt as any).thickness)) {
        console.log(tag(`Updating thickness value from ${(thEnt as any).thickness} to ${newThicknessValue}`));
        (thEnt as any).thickness = newThicknessValue;
        await this.thicknessRepository.save(thEnt);
        
        // Update the lookup map with new value
        thicknessByVal.delete(Number((thEnt as any).thickness));
        thicknessByVal.set(newThicknessValue, thEnt);
      }
    }

    if (!thEnt) {
      throw new Error('Thickness entity not found for editing');
    }

    console.log(
      tag('Editing within thickness:'),
      j({ thEntId: thEnt.id, thValue: String((thEnt as any).thickness) }),
    );

    // Process variants
    for (const vDto of thDto.variants ?? []) {
      console.log(tag('Incoming variant DTO:'), j(vDto));

      const variantId = Number(vDto.id);
      if (!Number.isFinite(variantId)) {
        console.log(tag('ERROR: invalid variant id'), vDto.id);
        throw new Error(`Each edited variant must include a valid 'id'.`);
      }

      const targetVariant = await this.itemVariantRepository.findOne({
        where: { id: variantId },
        relations: [
          'thickness',
          'thickness.item',
          'itemNameDescription',
          'realDescription',
        ],
      });

      console.log(
        tag('Variant lookup (DB) result:'),
        j({
          requestedVariantId: variantId,
          found: !!targetVariant,
          foundThicknessId: (targetVariant as any)?.thickness?.id ?? null,
          foundItemId: (targetVariant as any)?.thickness?.item?.id ?? null,
          editingItemId: item.id,
        }),
      );

      if (!targetVariant) {
        throw new Error(`Variant id ${variantId} not found.`);
      }

      if ((targetVariant as any).thickness?.item?.id !== item.id) {
        console.log(
          tag('ERROR: Variant does not belong to this item'),
          j({
            variantId: (targetVariant as any).id,
            variantItemId: (targetVariant as any).thickness?.item?.id,
            expectedItemId: item.id,
            incomingThicknessId: thEnt.id,
            itemThicknessIds: (item.thicknesses ?? []).map(t => (t as any).id),
          }),
        );
        throw new Error(`Variant id ${variantId} does not belong to the specified item.`);
      }

      if ((targetVariant as any).thickness?.id !== thEnt.id) {
        console.log(
          tag('Moving variant to target thickness'),
          j({
            variantId: (targetVariant as any).id,
            fromThicknessId: (targetVariant as any).thickness?.id,
            toThicknessId: thEnt.id,
          }),
        );
        (targetVariant as any).thickness = thEnt;
      }

      const next = {
        length: (isSQM || isUNIT) ? 0 : toNum(vDto.length, Number((targetVariant as any).length)),
        width:  (isSQM || isUNIT) ? 0 : toNum(vDto.width, Number((targetVariant as any).width)),
        sheetsPerBox: (isSQM ? 0 : (isUNIT ? 1 : toNum(vDto.sheetsPerBox, Number((targetVariant as any).sheetsPerBox)))),
        origin: (isSQM ? '' : (isUNIT ? ((vDto.origin ?? (targetVariant as any).origin ?? '-') || '-') : (vDto.origin ?? (targetVariant as any).origin ?? ''))),
        fixBox: vDto.fixBox ?? !!(targetVariant as any).fixBox,
        fixLength: vDto.fixLength ?? !!(targetVariant as any).fixLength,
        fixWidth: vDto.fixWidth ?? !!(targetVariant as any).fixWidth,
      };

      console.log(tag('Computed next fields:'), j(next));

      let nextDesc = (targetVariant as any).itemNameDescription ?? null;
      if (vDto.description && typeof vDto.description === 'object' && 'id' in (vDto.description as any)) {
        const newDescId = Number((vDto.description as any).id);
        if (Number.isFinite(newDescId)) {
          nextDesc = await getDescById(newDescId);
          console.log(tag('Re-linked description to id=' + newDescId));
        }
      }

      let nextRealDesc = (targetVariant as any).realDescription ?? null;
      if (vDto.realDescription && typeof vDto.realDescription === 'object' && 'id' in (vDto.realDescription as any)) {
        const newRealDescId = Number((vDto.realDescription as any).id);
        if (Number.isFinite(newRealDescId)) {
          nextRealDesc = await getRealDescById(newRealDescId);
          console.log(tag('Re-linked realDescription to id=' + newRealDescId));
        }
      }

      (targetVariant as any).length = next.length;
      (targetVariant as any).width = next.width;
      (targetVariant as any).sheetsPerBox = next.sheetsPerBox;
      (targetVariant as any).origin = next.origin;
      (targetVariant as any).fixBox = next.fixBox;
      (targetVariant as any).fixLength = next.fixLength;
      (targetVariant as any).fixWidth = next.fixWidth;
      (targetVariant as any).itemNameDescription = nextDesc;
      (targetVariant as any).realDescription = nextRealDesc;

      await this.itemVariantRepository.save(targetVariant);
      console.log(tag('Saved variant id=' + (targetVariant as any).id));

      if (!thEnt.variants.some((v: any) => v.id === (targetVariant as any).id)) {
        thEnt.variants.push(targetVariant as any);
      }
    }
  }

  await this.thicknessRepository.save(item.thicknesses);

  const updated = await this.itemRepository.findOne({
    where: { id: item.id },
    relations: [
      'thicknesses',
      'thicknesses.variants',
      'thicknesses.variants.itemNameDescription',
      'thicknesses.variants.realDescription',
    ],
  });

  console.log(tag('Done. Returning updated item id=' + item.id));
  return updated!;
}




async editFullItemByRealDescription(editDto: {
  itemId?: number;
  itemName?: string;
  type?: 'box'|'sheet'|'sqm';
  thicknesses: Array<{
    thicknessId?: number;
    thickness?: number | string;
    variants: Array<{
      id: number; // REQUIRED to edit in place
      length?: number | string;
      width?: number | string;
      sheetsPerBox?: number | string;
      origin?: string;
      fixBox?: boolean;
      fixLength?: boolean;
      fixWidth?: boolean;
      // Optional re-link (no creation): only id is honored
      realDescription?: { id?: number } | null;
    }>;
  }>;
}): Promise<Item> {
  const toNum = (v: any, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const normType = (t?: string) =>
    (t === 'box' || t === 'sheet' || t === 'sqm') ? t : 'box';

  const tag = (s: string) => `[editFullItemByRealDescription] ${s}`;
  const j = (o: any) => JSON.stringify(o);

  console.log(tag('Incoming DTO:'), j(editDto));

  const { itemId, itemName, type } = editDto;
  const tType = normType(type);

  // 1) Load item with relations (thicknesses + variants + realDescription)
  let item: Item | null = null;
  if (itemId) {
    console.log(tag(`Loading item by id=${itemId} with relations...`));
    item = await this.itemRepository.findOne({
      where: { id: itemId },
      relations: [
        'thicknesses',
        'thicknesses.variants',
        'thicknesses.variants.realDescription',
      ],
    });
  } else if (itemName && tType) {
    console.log(tag(`Loading item by (itemName,type)=(${itemName},${tType}) with relations...`));
    item = await this.itemRepository.findOne({
      where: { itemName, type: tType },
      relations: [
        'thicknesses',
        'thicknesses.variants',
        'thicknesses.variants.realDescription',
      ],
    });
  }

  if (!item) {
    console.log(tag('ERROR: Item not found for editing'));
    throw new Error('Item to edit not found (provide itemId or (itemName,type)).');
  }

  console.log(
    tag('Loaded item:'),
    j({
      itemId: item.id,
      type: item.type,
      thicknessCount: item.thicknesses?.length ?? 0,
      thicknessIds: (item.thicknesses ?? []).map(t => t.id),
    })
  );

  const isSQM = item.type === 'sqm';

  // 2) Build quick lookups for thickness
  const thicknessById = new Map<number, Thickness>();
  const thicknessByVal = new Map<number, Thickness>();
  for (const th of item.thicknesses ?? []) {
    thicknessById.set(th.id, th);
    thicknessByVal.set(Number(th.thickness), th);
    th.variants = th.variants ?? [];
  }

  const findThicknessStrict = (incoming: { thicknessId?: number; thickness?: any }) => {
    const fromId = incoming?.thicknessId;
    const fromValNum = toNum(incoming?.thickness);
    console.log(tag('Resolving thickness from incoming:'), j({ fromId, fromVal: fromValNum }));

    if (fromId && thicknessById.has(fromId)) {
      console.log(tag(`Resolved thickness by id=${fromId}`));
      return thicknessById.get(fromId)!;
    }
    if (Number.isFinite(fromValNum) && thicknessByVal.has(fromValNum)) {
      console.log(tag(`Resolved thickness by value=${fromValNum}`));
      return thicknessByVal.get(fromValNum)!;
    }
    console.log(tag('ERROR: Thickness not found on this item'));
    throw new Error(
      `Thickness not found on this item. Provide a valid thicknessId or an existing numeric thickness.`
    );
  };

  // Optional: cache for REAL description entities
  const realDescCache = new Map<number, any>();
  const getRealDescById = async (id?: number | null) => {
    if (!id) return null;
    if (realDescCache.has(id)) return realDescCache.get(id);
    const ent = await this.realDescriptionRepository.findOne({ where: { id } });
    if (!ent) {
      console.log(tag(`ERROR: RealDescription id ${id} not found.`));
      throw new Error(`RealDescription id ${id} not found.`);
    }
    realDescCache.set(id, ent);
    return ent;
  };

  // 3) Apply edits per thickness/variant
  for (const thDto of editDto.thicknesses ?? []) {
    console.log(tag('Incoming thickness DTO:'), j(thDto));
    const thEnt = findThicknessStrict(thDto);
    console.log(
      tag('Editing within thickness:'),
      j({ thEntId: thEnt.id, thValue: String(thEnt.thickness) })
    );

    for (const vDto of thDto.variants ?? []) {
      console.log(tag('Incoming variant DTO:'), j(vDto));

      const variantId = Number(vDto.id);
      if (!Number.isFinite(variantId)) {
        console.log(tag('ERROR: invalid variant id'), vDto.id);
        throw new Error(`Each edited variant must include a valid 'id'.`);
      }

      // 🔴 Always DB-load variant WITH relations so thickness.item is present
      const targetVariant = await this.itemVariantRepository.findOne({
        where: { id: variantId },
        relations: ['thickness', 'thickness.item', 'realDescription'],
      });

      console.log(
        tag('Variant lookup (DB) result:'),
        j({
          requestedVariantId: variantId,
          found: !!targetVariant,
          foundThicknessId: targetVariant?.thickness?.id ?? null,
          foundItemId: targetVariant?.thickness?.item?.id ?? null,
          editingItemId: item.id,
        })
      );

      if (!targetVariant) {
        throw new Error(`Variant id ${variantId} not found.`);
      }

      // ✅ Ownership check now reliable
      if (targetVariant.thickness?.item?.id !== item.id) {
        console.log(
          tag('ERROR: Variant does not belong to this item'),
          j({
            variantId: targetVariant.id,
            variantItemId: targetVariant.thickness?.item?.id,
            expectedItemId: item.id,
            incomingThicknessId: thEnt.id,
            itemThicknessIds: (item.thicknesses ?? []).map(t => t.id),
          })
        );
        throw new Error(`Variant id ${variantId} does not belong to the specified item.`);
      }

      // If variant is currently on a different thickness within the SAME item, move it
      if (targetVariant.thickness?.id !== thEnt.id) {
        console.log(
          tag('Moving variant to target thickness'),
          j({
            variantId: targetVariant.id,
            fromThicknessId: targetVariant.thickness?.id,
            toThicknessId: thEnt.id,
          })
        );
        targetVariant.thickness = thEnt;
      }

      // Compute next field values, enforcing SQM invariants
      const next = {
        length: isSQM ? 0 : toNum(vDto.length, Number(targetVariant.length)),
        width: isSQM ? 0 : toNum(vDto.width, Number(targetVariant.width)),
        sheetsPerBox: isSQM ? 0 : toNum(vDto.sheetsPerBox, Number(targetVariant.sheetsPerBox)),
        origin: isSQM ? '' : (vDto.origin ?? targetVariant.origin ?? ''),
        fixBox: vDto.fixBox ?? !!targetVariant.fixBox,
        fixLength: vDto.fixLength ?? !!targetVariant.fixLength,
        fixWidth: vDto.fixWidth ?? !!targetVariant.fixWidth,
      };

      console.log(tag('Computed next fields:'), j(next));

      // Keep current REAL description UNCHANGED unless realDescription.id is explicitly provided.
      let nextRealDesc = targetVariant.realDescription ?? null;
      if (vDto.realDescription && typeof vDto.realDescription === 'object' && 'id' in vDto.realDescription!) {
        const newRealId = Number(vDto.realDescription!.id);
        if (Number.isFinite(newRealId)) {
          nextRealDesc = await getRealDescById(newRealId); // will throw if id doesn't exist
          console.log(tag('Re-linked REAL description to id=' + newRealId));
        }
      } else if (vDto.realDescription === null) {
        // explicit unlink allowed if you want this behavior
        nextRealDesc = null;
        console.log(tag('Unlinked REAL description (set to null)'));
      }

      // Apply updates
      targetVariant.length = next.length;
      targetVariant.width = next.width;
      targetVariant.sheetsPerBox = next.sheetsPerBox;
      targetVariant.origin = next.origin;
      targetVariant.fixBox = next.fixBox;
      targetVariant.fixLength = next.fixLength;
      targetVariant.fixWidth = next.fixWidth;
      targetVariant.realDescription = nextRealDesc;

      await this.itemVariantRepository.save(targetVariant);
      console.log(tag('Saved variant id=' + targetVariant.id));

      // keep the in-memory thickness list consistent (for subsequent loops)
      if (!thEnt.variants.some(v => v.id === targetVariant.id)) {
        thEnt.variants.push(targetVariant);
      }
    }
  }

  // Save thickness containers if needed (mostly no-op)
  await this.thicknessRepository.save(item.thicknesses);

  // Reload and return updated item (including REAL description on variants)
  const updated = await this.itemRepository.findOne({
    where: { id: item.id },
    relations: [
      'thicknesses',
      'thicknesses.variants',
      'thicknesses.variants.realDescription',
    ],
  });

  console.log(tag('Done. Returning updated item id=' + item.id));
  return updated!;
}


async getitemDetails(opts?: { page?: number; limit?: number }) {
  // ---- paging is by *rows* (table lines), not by item-name groups ----
  const page = Math.max(1, Number(opts?.page ?? 1));
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
  //    ONLY variants that have realDescriptionId
  // -------------------------------------------------------------------
  const entities = await this.itemRepository
    .createQueryBuilder("item")
    .leftJoinAndSelect("item.thicknesses", "thickness")
    .leftJoinAndSelect("thickness.variants", "variant")
    .leftJoinAndSelect("variant.realDescription", "realDesc")
    .leftJoinAndSelect("variant.batches", "batch")
    .select([
      // item
      "item.id",
      "item.itemName",
      "item.type",
      "item.sortIndex",
      "item.stockMode", // ✅ ADDED
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
      "variant.realDescriptionId",
      // real description
      "realDesc.id",
      "realDesc.categoryName",
      "realDesc.subCategory",
      "realDesc.colorName",
      "realDesc.designName",
      "realDesc.sort_index_real_description",
      // batch
      "batch.id",
      "batch.condition",
      "batch.dateReceived",
      "batch.balanceOFR",
    ])
    .where("variant.realDescriptionId IS NOT NULL") // ✅ filter ONLY those that have real desc
    .orderBy("item.id", "ASC")
    .addOrderBy("thickness.id", "ASC")
    .addOrderBy("variant.id", "ASC")
    .addOrderBy("batch.id", "ASC")
    .getMany();

  // -------------------------------------------------------------------
  // 2) Flatten (FILTER OUT ZERO/NEGATIVE STOCK for non-unit)
  // -------------------------------------------------------------------
  type Flat = {
    // item
    itemId: number;
    itemName: string;
    itemSortIndex: number | null;
    type: string; // 'box' | 'sheet' | 'sqm' | 'unit'
    itemType: string; // ✅ ADDED (same as type, but explicit)
    stockMode: string; // ✅ ADDED (e.g. 'sqm' | 'qty' | 'none')
    // thickness
    thicknessId: number;
    thickness: number;
    thicknessSortIndex: number | null;
    // variant
    variantId: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string | null;
    // real description group
    realDescId: number | null;
    realDescSortIndex: number | null;
    realDescLabel: string;
    realDescriptionId: number | null;
    realDescription: any | null;
    // batches
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
    const itemTypeLower = String(item.type || "").toLowerCase();
    const allowZeroOrNegative = itemTypeLower === "unit";

    // ✅ ADDED: stockMode on the item (default to 'sqm' for backward-compat)
    const stockModeLower =
      String((item as any).stockMode ?? "").trim().toLowerCase() || "sqm";

    for (const th of item.thicknesses || []) {
      for (const v of th.variants || []) {
        const lengthNum = toNum(v.length);
        const widthNum = toNum(v.width);
        const spbNum = Math.max(1, toNum(v.sheetsPerBox));

        const batches = (v.batches || [])
          .map((b) => {
            const balanceSqm = toNum(b.balanceOFR);
            const converted = convertBalanceFromSqm({
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
          // ✅ NEW RULE:
          // - unit: keep all rows
          // - non-unit: keep only positive balance
          .filter((row) => allowZeroOrNegative || row.balanceOFR > 0);

        // ✅ if no valid batches remain, drop the variant entirely
        if (!batches.length) continue;

        const d = (v as any).realDescription || null;
        const realDescLabel = d
          ? [d.categoryName ?? "", d.subCategory ?? "", d.colorName ?? "", d.designName ?? ""].join(
              " | "
            )
          : "ZZZ (No Description)";

        flat.push({
          itemId: item.id,
          itemName: item.itemName,
          itemSortIndex: (item as any)?.sortIndex ?? null,
          type: itemTypeLower,
          itemType: itemTypeLower, // ✅ ADDED
          stockMode: stockModeLower, // ✅ ADDED
          thicknessId: th.id,
          thickness: toNum((th as any).thickness),
          thicknessSortIndex: (th as any)?.sort_index ?? null,
          variantId: v.id,
          length: lengthNum,
          width: widthNum,
          sheetsPerBox: spbNum,
          origin: (v as any)?.origin ?? null,
          realDescId: (v as any).realDescriptionId ?? null,
          realDescSortIndex: d?.sort_index_real_description ?? null,
          realDescLabel,
          realDescriptionId: (v as any).realDescriptionId || null,
          realDescription: d
            ? {
                id: d.id,
                categoryName: d.categoryName,
                subCategory: d.subCategory,
                colorName: d.colorName,
                designName: d.designName,
                sort_index_real_description: d.sort_index_real_description ?? null,
              }
            : null,
          batches,
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 3) ORDERING (keyed by real description)
  // -------------------------------------------------------------------
  const nullLastNum = (n: any) => (n == null ? Number.POSITIVE_INFINITY : Number(n));
  const byDesc = new Map<number | "null", Flat[]>();

  for (const r of flat) {
    const key = r.realDescId ?? "null";
    if (!byDesc.has(key)) byDesc.set(key, []);
    byDesc.get(key)!.push(r);
  }

  const descKeys = Array.from(byDesc.keys()).sort((ka, kb) => {
    const aArr = byDesc.get(ka)!;
    const bArr = byDesc.get(kb)!;
    const aMin = Math.min(...aArr.map((x) => nullLastNum(x.realDescSortIndex)));
    const bMin = Math.min(...bArr.map((x) => nullLastNum(x.realDescSortIndex)));
    if (aMin !== bMin) return aMin - bMin;
    const aLbl = aArr[0]?.realDescLabel ?? "";
    const bLbl = bArr[0]?.realDescLabel ?? "";
    return aLbl.localeCompare(bLbl);
  });

  const ordered: Flat[] = [];

  for (const dKey of descKeys) {
    const rowsOfDesc = byDesc.get(dKey)!;

    // group by thickness numeric
    const byTh = new Map<number, Flat[]>();
    for (const r of rowsOfDesc) {
      if (!byTh.has(r.thickness)) byTh.set(r.thickness, []);
      byTh.get(r.thickness)!.push(r);
    }

    const thKeys = Array.from(byTh.keys()).sort((ta, tb) => {
      const aArr = byTh.get(ta)!;
      const bArr = byTh.get(tb)!;
      const aMin = Math.min(...aArr.map((x) => nullLastNum(x.thicknessSortIndex)));
      const bMin = Math.min(...bArr.map((x) => nullLastNum(x.thicknessSortIndex)));
      if (aMin !== bMin) return aMin - bMin;
      return ta - tb; // numeric thickness ASC
    });

    for (const th of thKeys) {
      const rowsTh = byTh.get(th)!;

      // split dimensioned vs others
      const dimmed = rowsTh.filter((r) => r.length > 0 && r.width > 0);
      const nonDimmed = rowsTh.filter((r) => !(r.length > 0 && r.width > 0) || r.type === "sqm");

      // group dimmed by **length only**
      const byLen = new Map<number, Flat[]>();
      for (const r of dimmed) {
        if (!byLen.has(r.length)) byLen.set(r.length, []);
        byLen.get(r.length)!.push(r);
      }

      // LENGTH ORDER: length ASC (ignore width)
      const lenKeys = Array.from(byLen.keys()).sort((a, b) => a - b);

      for (const lk of lenKeys) {
        const g = byLen.get(lk)!;

        // keep type order: box → sheet → sqm (no width sort)
        const boxes = g
          .filter((x) => x.type === "box")
          .sort(
            (a, b) =>
              (b.sheetsPerBox || 0) - (a.sheetsPerBox || 0) || a.variantId - b.variantId
          );

        const sheets = g.filter((x) => x.type === "sheet").sort((a, b) => a.variantId - b.variantId);

        const sqms = g.filter((x) => x.type === "sqm");
        ordered.push(...boxes, ...sheets, ...sqms);
      }

      // place unspecified dims after (same as before)
      const sqmOthers = nonDimmed
        .filter((x) => x.type === "sqm")
        .sort((a, b) => a.variantId - b.variantId);
      const noDimsNonSqm = nonDimmed.filter((x) => x.type !== "sqm");
      ordered.push(...sqmOthers, ...noDimsNonSqm);
    }
  }

  // -------------------------------------------------------------------
  // 4) Expand to *rows* and paginate AFTER ordering
  // -------------------------------------------------------------------
  type Row = {
    itemId: number;
    itemName: string;
    type: string;
    itemType: string; // ✅ ADDED
    stockMode: string; // ✅ ADDED
    variantId: number;
    thickness: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string | null;
    realDescriptionId: number | null;
    realDescription: any | null;
    batchId?: number | null;
    condition?: string | null;
    dateReceived?: string | Date | null;
    balanceOFR?: number | null;
  };

  const allRows: Row[] = [];
  for (const r of ordered) {
    for (const b of r.batches) {
      allRows.push({
        itemId: r.itemId,
        itemName: r.itemName,
        type: r.type,
        itemType: r.itemType, // ✅ ADDED
        stockMode: r.stockMode, // ✅ ADDED
        variantId: r.variantId,
        thickness: r.thickness,
        length: r.length,
        width: r.width,
        sheetsPerBox: r.sheetsPerBox,
        origin: r.origin,
        realDescriptionId: r.realDescriptionId,
        realDescription: r.realDescription,
        batchId: b.id,
        condition: b.condition,
        dateReceived: b.dateReceived,
        balanceOFR: b.balanceOFR,
      });
    }
  }

  const totalRows = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const pageRows = allRows.slice(start, start + limit);

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
  type?: "box" | "sheet" | "sqm" | "unit";
  page: number;
  limit: number;
  includeEmpty?: boolean;
  roundUnitsToInt?: boolean;
}) {
  const { q, dims, includeEmpty, roundUnitsToInt } = params;

  // Parse tokens
  const { thickness, cleanName, nmNorm } = this.parseThicknessFromQ(q || "");
  const parsedDims = this.parseDims(dims);
  const length = params.length ?? parsedDims.length;
  const width = params.width ?? parsedDims.width;
  const spb = params.spb ?? parsedDims.spb;
  const type = params.type ?? parsedDims.type;

  const qb = this.baseQBForModal();

  // ✅ Ensure stockMode is selected (important if baseQBForModal uses .select([...]))
  qb.addSelect("item.stockMode");

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
    qb.andWhere("item.type = :tp", { tp: type });
  }

  // Thickness tolerance
  if (typeof thickness === "number" && !Number.isNaN(thickness)) {
    qb.andWhere("ABS(thickness.thickness - :th) < :thTol", {
      th: thickness,
      thTol: 0.011,
    });
  }

  // Dimensions tolerance + swap
  const tol = 0.51;
  const hasLen = typeof length === "number" && !Number.isNaN(length);
  const hasWid = typeof width === "number" && !Number.isNaN(width);

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
    qb.andWhere("ABS(variant.length - :len) < :tol", { len: length!, tol });
  } else if (hasWid) {
    qb.andWhere("ABS(variant.width - :wid) < :tol", { wid: width!, tol });
  }

  // Sheets/box exact match if provided
  if (typeof spb === "number" && !Number.isNaN(spb)) {
    qb.andWhere("variant.sheetsPerBox = :spb", { spb });
  }

  qb
    .orderBy("item.id", "DESC")
    .addOrderBy("thickness.thickness", "ASC")
    .addOrderBy("variant.id", "ASC");

  const appliedFilters: string[] = [];
  if (cleanName)
    appliedFilters.push(
      `normalized(item.itemName) LIKE %${nmNorm || cleanName}% OR raw LIKE %${cleanName}%`
    );
  if (type) appliedFilters.push(`item.type = ${type}`);
  if (typeof thickness === "number")
    appliedFilters.push(`ABS(thickness.thickness - ${thickness}) < 0.011`);
  if (hasLen && hasWid) {
    appliedFilters.push(`dims ~ (${length}×${width}) with swap & tol ${tol}`);
  } else if (hasLen) {
    appliedFilters.push(`length ~ ${length} tol ${tol}`);
  } else if (hasWid) {
    appliedFilters.push(`width ~ ${width} tol ${tol}`);
  }
  if (typeof spb === "number") appliedFilters.push(`variant.sheetsPerBox = ${spb}`);

  const pageNum = Number.isFinite(Number(params.page)) ? Math.max(1, Number(params.page)) : 1;
  const limitNum = Number.isFinite(Number(params.limit))
    ? Math.min(500, Math.max(1, Number(params.limit)))
    : 50;

  const results = await this.runAndFilter(qb, pageNum, limitNum, {
    includeEmpty,
    roundUnitsToInt,
  });

  if (!results.length) {
    console.log("[SRV] No records matched. Tips:", [
      "• Verify SPB (e.g., -023 → 23).",
      "• Try includeEmpty=1 to see variants without stock.",
      "• Try removing dims to see if name+thickness match.",
      "• Check spelling/normalization (أبيض vs ابيض).",
    ]);
  }

  // ✅ Inject itemType + stockMode into the returned nested items
  // (so frontend can read item.itemType and item.stockMode like StockTab does)
  const out = (results || []).map((item: any) => {
    const typeLower = String(item?.type ?? "").toLowerCase();
    return {
      ...item,
      itemType: item?.itemType ?? typeLower,            // ✅
      stockMode: item?.stockMode ?? item?.item?.stockMode ?? null, // ✅
    };
  });

  return out;
}




  // items.service.ts
async getitemDetailsAllBatches(opts?: { page?: number; limit?: number }) {
  // ---- paginate by *rows* (table lines) ----
  const page = Math.max(1, Number(opts?.page ?? 1));
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
      "item.stockMode", // ✅ ADD
      "item.sortIndex", // entity is camelCase; DB col is sort_index

      // thickness
      "thickness.id",
      "thickness.thickness",
      "thickness.sort_index", // entity exposes snake_case

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
    stockMode: string | null; // ✅ ADD (e.g. 'SQM' | 'QTY' | 'NONE')

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
      balanceOFR: number; // converted count (may be 0 or negative)
    }>;
  };

  const flat: Flat[] = [];

  for (const item of entities) {
    for (const th of item.thicknesses || []) {
      for (const v of th.variants || []) {
        const lengthNum = toNum(v.length);
        const widthNum = toNum(v.width);
        const spbNum = Math.max(1, toNum(v.sheetsPerBox));

        // Map every batch (keep even if converted balance <= 0)
        const mappedBatches = (v.batches || []).map((b) => {
          const balanceSqm = toNum(b.balanceOFR);
          const converted = convertBalanceFromSqm({
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
        if (mappedBatches.length === 0) continue;

        flat.push({
          itemId: item.id,
          itemName: item.itemName,
          itemSortIndex: (item as any)?.sortIndex ?? null,

          type: String(item.type || "").toLowerCase(),
          stockMode: (item as any)?.stockMode ?? null, // ✅ ADD

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

      const dimmed = rowsTh.filter((r) => r.length > 0 && r.width > 0);
      const nonDimmed = rowsTh.filter(
        (r) => !(r.length > 0 && r.width > 0) || r.type === "sqm"
      );

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
        const aArea = aL * aW,
          bArea = bL * bW;
        if (aArea !== bArea) return bArea - aArea;
        if (aL !== bL) return bL - aL;
        return bW - aW;
      });

      // Emit box → sheet → sqm for each dims group
      for (const dk of dimKeys) {
        const g = byDims.get(dk)!;

        const boxes = g
          .filter((x) => x.type === "box")
          .sort(
            (a, b) =>
              (b.sheetsPerBox || 0) - (a.sheetsPerBox || 0) ||
              a.variantId - b.variantId
          );

        const sheets = g
          .filter((x) => x.type === "sheet")
          .sort((a, b) => a.variantId - b.variantId);

        const sqms = g.filter((x) => x.type === "sqm");

        ordered.push(...boxes, ...sheets, ...sqms);
      }

      // then sqm without dims, then any other no-dims
      const sqmOthers = nonDimmed
        .filter((x) => x.type === "sqm")
        .sort((a, b) => a.variantId - b.variantId);

      const noDimsNonSqm = nonDimmed.filter((x) => x.type !== "sqm");

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

    type: string; // what your table currently uses
    itemType: string; // ✅ ADD (for your frontend payload consistency)

    stockMode: string | null; // ✅ ADD

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
    balanceOFR: number | null; // may be 0 or negative
  };

  const allRows: Row[] = [];

  for (const r of ordered) {
    for (const b of r.batches) {
      allRows.push({
        itemId: r.itemId,
        itemName: r.itemName,

        type: r.type,
        itemType: r.type, // ✅ same value (frontend expects itemType)
        stockMode: r.stockMode, // ✅

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

  const totalRows = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const pageRows = allRows.slice(start, start + limit);

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
  type?: "box" | "sheet" | "sqm" | "unit";
  page: number;
  limit: number;
  roundUnitsToInt?: boolean;
}) {
  const { q } = params;

  // Parse tokens
  const { thickness, cleanName, nmNorm } = this.parseThicknessFromQ(q || "");
  const parsedDims = this.parseDims(params.dims);
  const length = params.length ?? parsedDims.length;
  const width  = params.width  ?? parsedDims.width;
  const spb    = params.spb    ?? parsedDims.spb;
  const type   = params.type   ?? parsedDims.type;

  const qb = this.baseQBForModal();

  // ✅ IMPORTANT:
  // baseQBForModal() already selects item.type (alias item_type), so DON'T addSelect(item.type) again.
  // We only add the missing column:
  qb.addSelect("item.stockMode"); // -> alias becomes item_stockMode

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

  // Optional item.type filter
  if (type) qb.andWhere("item.type = :tp", { tp: type });

  // Thickness tolerance
  if (typeof thickness === "number" && !Number.isNaN(thickness)) {
    qb.andWhere("ABS(thickness.thickness - :th) < :thTol", {
      th: thickness,
      thTol: 0.011,
    });
  }

  // Dimensions tolerance (+ swap)
  const tol = 0.51;
  const hasLen = typeof length === "number" && !Number.isNaN(length);
  const hasWid = typeof width === "number" && !Number.isNaN(width);

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
    qb.andWhere("ABS(variant.length - :len) < :tol", { len: length!, tol });
  } else if (hasWid) {
    qb.andWhere("ABS(variant.width - :wid) < :tol", { wid: width!, tol });
  }

  // Sheets/box exact match
  if (typeof spb === "number" && !Number.isNaN(spb)) {
    qb.andWhere("variant.sheetsPerBox = :spb", { spb });
  }

  qb.orderBy("item.id", "DESC")
    .addOrderBy("thickness.thickness", "ASC")
    .addOrderBy("variant.id", "ASC");

  const pageNum = Number.isFinite(Number(params.page)) ? Math.max(1, Number(params.page)) : 1;
  const limitNum = Number.isFinite(Number(params.limit))
    ? Math.min(500, Math.max(1, Number(params.limit)))
    : 50;

  const results = await this.runAndFilter(qb, pageNum, limitNum, {
    includeEmpty: true,
    roundUnitsToInt: params.roundUnitsToInt,
  });

  // helper: support entity OR raw output
  const pickItemType = (item: any) =>
    String(item?.type ?? item?.item_type ?? item?.itemType ?? item?.["item_type"] ?? "").toLowerCase();

  const pickStockMode = (item: any) =>
    item?.stockMode ??
    item?.item_stockMode ??      // default TypeORM alias
    item?.item_stock_mode ??
    item?.["item_stockMode"] ??
    item?.["item_stock_mode"] ??
    null;

  const filtered = (results || [])
    .map((item: any) => {
      const itemType = pickItemType(item);
      const isUnit = itemType === "unit";
      const stockMode = pickStockMode(item); // ✅ REAL or null (NO DEFAULT)

      const thicknesses = (item.thicknesses || [])
        .map((th: any) => {
          const variants = (th.variants || [])
            .map((v: any) => {
              const batchesRaw = Array.isArray(v.batches) ? v.batches : [];
              const batches = isUnit
                ? batchesRaw
                : batchesRaw.filter((b: any) => Number(b.balanceOFR) > 0);

              return {
                ...v,
                batches,
                itemType,
                stockMode,
              };
            })
            .filter((v: any) => (isUnit ? true : Array.isArray(v.batches) && v.batches.length > 0));

          return { ...th, variants };
        })
        .filter((th: any) => Array.isArray(th.variants) && th.variants.length > 0);

      return {
        ...item,
        thicknesses,
        itemType,
        stockMode,
      };
    })
    .filter((item: any) => Array.isArray(item.thicknesses) && item.thicknesses.length > 0);

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

// using real description
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

  // 🔒 Exclude variants that don't have a real description
  //    (use the actual FK column name/alias in your schema)
  qb.andWhere('variant.realDescriptionId IS NOT NULL');

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

// using item name description

async searchVariantsForModalPOSByNameDescription(params: {
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

  // 🔗 Make sure ItemNameDescription is joined
  // (If baseQBForVariantModal already does this, you can remove this line.)
  qb.leftJoinAndSelect('variant.itemNameDescription', 'ind');

  // 🔒 Exclude variants that don't have an ItemNameDescription
  qb.andWhere('variant.itemNameDescriptionId IS NOT NULL');

  // name (Arabic-normalized OR raw) – still based on item.itemName
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
      th: thickness,
      thTol: 0.011,
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
    qb.andWhere('ABS(CAST(variant.length AS DECIMAL(10,3)) - :len) < :tol', {
      len: Number(length),
      tol,
    });
  } else if (hasWid) {
    qb.andWhere('ABS(CAST(variant.width AS DECIMAL(10,3)) - :wid) < :tol', {
      wid: Number(width),
      tol,
    });
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
  const data = entities.map((v: any) => {
    const ind = v.itemNameDescription || null;

    return {
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

      // 🔁 Same as before
      itemNameDescriptionId: v.itemNameDescriptionId ?? null,

      // 🆕 Extra fields from ItemNameDescription
      itemNumber: ind?.itemNumber ?? null,
      subCategory: ind?.subCategory ?? null,
    };
  });

  return {
    page,
    limit,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / limit)),
    hasMore: page * limit < totalRows,
    data,
  };
}




//search items api


 private normalizeDigits(s: string): string {
    if (!s) return '';
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    };
    return s.replace(/[٠-٩]/g, (d) => map[d] ?? d);
  }

  // Extracts: thickness (…ملم), size (225*321 / 225x321 / 225×321), optional -027, and leftover text
  private parseQuery(raw: string): {
    thickness?: number;
    length?: number;
    width?: number;
    sheetsPerBox?: number;
    nameText?: string; // remaining text tokens
  } {
    const input = this.normalizeDigits((raw || '').trim());
    const out: { thickness?: number; length?: number; width?: number; sheetsPerBox?: number; nameText?: string } = {};

    let q = input;

    // thickness: 5ملم or "5 ملم"
    const thRe = /(\d+(?:\.\d+)?)\s*ملم/gi;
    const thMatch = thRe.exec(q);
    if (thMatch) {
      out.thickness = Number(thMatch[1]);
      q = q.replace(thMatch[0], ' ').trim();
    }

    // size: 225*321 or 225x321 or 225×321 (allow spaces)
    const sizeRe = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i;
    const sizeMatch = sizeRe.exec(q);
    if (sizeMatch) {
      out.length = Number(sizeMatch[1]);
      out.width  = Number(sizeMatch[2]);
      q = q.replace(sizeMatch[0], ' ').trim();
    }

    // sheets per box: trailing -027 or -27 (allow spaces)
    const spbRe = /-\s*(\d{1,3})\s*$/;
    const spbMatch = spbRe.exec(q);
    if (spbMatch) {
      out.sheetsPerBox = parseInt(spbMatch[1], 10);
      q = q.replace(spbMatch[0], ' ').trim();
    }

    // remaining text tokens → nameText
    const leftover = q.replace(/\s{2,}/g, ' ').trim();
    if (leftover) out.nameText = leftover;

    return out;
  }

async searchSmart(q: string, page = 1, limit = 50) {
  const parsed = this.parseQuery(q);

  // Base query: we list VARIANTS; thickness & variant must exist
  const qb = this.itemRepository
    .createQueryBuilder('item')
    .innerJoin('item.thicknesses', 'th')
    .innerJoin('th.variants', 'v')
    .leftJoin('v.itemNameDescription', 'd')
    .select([
      'item.id AS itemId',
      'item.itemName AS itemName',
      'item.type AS type',
      'th.id AS thicknessId',
      'th.thickness AS thickness',
      'v.id AS variantId',
      // COALESCE to avoid undefined in raw rows
      'COALESCE(v.length, 0) AS length',
      'COALESCE(v.width, 0) AS width',
      'COALESCE(v.sheetsPerBox, 0) AS sheetsPerBox',
      'COALESCE(v.origin, \'\') AS origin',
      'd.id AS descId',
      'd.itemNumber AS itemNumber',
      'd.categoryName AS categoryName',
      'd.subCategory AS subCategory',
      'd.colorName AS colorName',
      'd.designName AS designName',
    ])
    .where('1=1');

  // Numeric filters (exact matches)
  if (parsed.thickness !== undefined) {
    qb.andWhere('th.thickness = :th', { th: parsed.thickness });
  }
  if (parsed.length !== undefined) {
    qb.andWhere('v.length = :len', { len: parsed.length });
  }
  if (parsed.width !== undefined) {
    qb.andWhere('v.width = :wid', { wid: parsed.width });
  }
  if (parsed.sheetsPerBox !== undefined) {
    qb.andWhere('v.sheetsPerBox = :spb', { spb: parsed.sheetsPerBox });
  }

  // Text search: AND across tokens, OR across fields
  if (parsed.nameText) {
    const tokens = parsed.nameText.split(/\s+/).filter(Boolean);
    tokens.forEach((t, idx) => {
      const like = `%${t}%`;
      qb.andWhere(new Brackets((w) => {
        w.where(`item.itemName LIKE :like${idx}`, { [`like${idx}`]: like })
          .orWhere(`d.itemNumber LIKE :like${idx}`, { [`like${idx}`]: like })
          .orWhere(`d.categoryName LIKE :like${idx}`, { [`like${idx}`]: like })
          .orWhere(`d.subCategory LIKE :like${idx}`, { [`like${idx}`]: like })
          .orWhere(`d.colorName LIKE :like${idx}`, { [`like${idx}`]: like })
          .orWhere(`d.designName LIKE :like${idx}`, { [`like${idx}`]: like });
      }));
    });
  }

  // Relevance / ordering
  if (parsed.nameText) {
    qb.addOrderBy(
      'CASE WHEN item.itemName = :exact THEN 0 WHEN item.itemName LIKE :prefix THEN 1 ELSE 2 END',
      'ASC',
    )
      .setParameter('exact', parsed.nameText)
      .setParameter('prefix', parsed.nameText + '%');
  }
  qb.addOrderBy('item.itemName', 'ASC')
    .addOrderBy('th.thickness', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.width', 'ASC');

  // GROUP BY to eliminate accidental duplicates from joins
  qb.groupBy('item.id')
    .addGroupBy('item.itemName')
    .addGroupBy('item.type')
    .addGroupBy('th.id')
    .addGroupBy('th.thickness')
    .addGroupBy('v.id')
    .addGroupBy('v.length')
    .addGroupBy('v.width')
    .addGroupBy('v.sheetsPerBox')
    .addGroupBy('v.origin')
    .addGroupBy('d.id')
    .addGroupBy('d.itemNumber')
    .addGroupBy('d.categoryName')
    .addGroupBy('d.subCategory')
    .addGroupBy('d.colorName')
    .addGroupBy('d.designName');

  // Count distinct variants (avoid TypeORM join count pitfalls)
  const countQb = qb.clone().select('COUNT(DISTINCT v.id)', 'cnt').orderBy(); // remove order for count
  const { cnt } = await countQb.getRawOne<{ cnt: string | number }>();
  const total = Number(cnt ?? 0);

  // Pagination
  qb.offset((page - 1) * limit).limit(limit);

  // Rows
  const rows = await qb.getRawMany();

  const data = rows.map((r) => ({
    itemId: Number(r.itemId),
    itemName: r.itemName,
    type: r.type as 'box' | 'sheet' | 'sqm',
    thicknessId: Number(r.thicknessId),
    thickness: Number(r.thickness),
    variantId: Number(r.variantId),
    length: Number(r.length ?? 0),
    width: Number(r.width ?? 0),
    sheetsPerBox: Number(r.sheetsPerBox ?? 0),
    origin: r.origin ?? null,
    description: {
      id: r.descId ? Number(r.descId) : null,
      itemNumber: r.itemNumber ?? null,
      categoryName: r.categoryName ?? null,
      subCategory: r.subCategory ?? null,
      colorName: r.colorName ?? null,
      designName: r.designName ?? null,
    },
  }));

  return { data, page, limit, total };
}


async searchSmartReal(q: string, page = 1, limit = 50) {
  const parsed = this.parseQuery(q);

  // Base: list VARIANTS; thickness & variant must exist
  const qb = this.itemRepository
    .createQueryBuilder('item')
    .innerJoin('item.thicknesses', 'th')
    .innerJoin('th.variants', 'v')
    .leftJoin('v.realDescription', 'rd') // 👈 real description
    .select([
      'item.id AS itemId',
      'item.itemName AS itemName',
      'item.type AS type',
      'th.id AS thicknessId',
      'th.thickness AS thickness',
      'v.id AS variantId',
      'COALESCE(v.length, 0) AS length',
      'COALESCE(v.width, 0) AS width',
      'COALESCE(v.sheetsPerBox, 0) AS sheetsPerBox',
      'COALESCE(v.origin, \'\') AS origin',
      'rd.id AS descId',
      'rd.itemNumber AS itemNumber',
      'rd.categoryName AS categoryName',
      'rd.subCategory AS subCategory',
      'rd.colorName AS colorName',
      'rd.designName AS designName',
      // If you keep a sort index for real descriptions, you can also expose it:
      // 'rd.sortIndexRealDescription AS sortIndexRealDescription',
    ])
    .where('1=1');

  // Numeric filters (exact)
  if (parsed.thickness !== undefined) {
    qb.andWhere('th.thickness = :th', { th: parsed.thickness });
  }
  if (parsed.length !== undefined) {
    qb.andWhere('v.length = :len', { len: parsed.length });
  }
  if (parsed.width !== undefined) {
    qb.andWhere('v.width = :wid', { wid: parsed.width });
  }
  if (parsed.sheetsPerBox !== undefined) {
    qb.andWhere('v.sheetsPerBox = :spb', { spb: parsed.sheetsPerBox });
  }

  // Text search: AND across tokens, OR across fields (use REAL description fields)
  if (parsed.nameText) {
    const tokens = parsed.nameText.split(/\s+/).filter(Boolean);
    tokens.forEach((t, idx) => {
      const like = `%${t}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where(`item.itemName LIKE :like${idx}`, { [`like${idx}`]: like })
            .orWhere(`rd.itemNumber LIKE :like${idx}`, { [`like${idx}`]: like })
            .orWhere(`rd.categoryName LIKE :like${idx}`, { [`like${idx}`]: like })
            .orWhere(`rd.subCategory LIKE :like${idx}`, { [`like${idx}`]: like })
            .orWhere(`rd.colorName LIKE :like${idx}`, { [`like${idx}`]: like })
            .orWhere(`rd.designName LIKE :like${idx}`, { [`like${idx}`]: like });
        }),
      );
    });
  }

  // Relevance / ordering (same approach)
  if (parsed.nameText) {
    qb.addOrderBy(
      'CASE WHEN item.itemName = :exact THEN 0 WHEN item.itemName LIKE :prefix THEN 1 ELSE 2 END',
      'ASC',
    )
      .setParameter('exact', parsed.nameText)
      .setParameter('prefix', parsed.nameText + '%');
  }
  qb.addOrderBy('item.itemName', 'ASC')
    .addOrderBy('th.thickness', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.width', 'ASC');

  // GROUP BY to avoid dupes
  qb.groupBy('item.id')
    .addGroupBy('item.itemName')
    .addGroupBy('item.type')
    .addGroupBy('th.id')
    .addGroupBy('th.thickness')
    .addGroupBy('v.id')
    .addGroupBy('v.length')
    .addGroupBy('v.width')
    .addGroupBy('v.sheetsPerBox')
    .addGroupBy('v.origin')
    .addGroupBy('rd.id')
    .addGroupBy('rd.itemNumber')
    .addGroupBy('rd.categoryName')
    .addGroupBy('rd.subCategory')
    .addGroupBy('rd.colorName')
    .addGroupBy('rd.designName');
    // .addGroupBy('rd.sortIndexRealDescription'); // only if selected above

  // Count distinct variants
  const countQb = qb.clone().select('COUNT(DISTINCT v.id)', 'cnt').orderBy();
  const { cnt } = await countQb.getRawOne<{ cnt: string | number }>();
  const total = Number(cnt ?? 0);

  // Pagination
  qb.offset((page - 1) * limit).limit(limit);

  // Rows
  const rows = await qb.getRawMany();

  const data = rows.map((r) => ({
    itemId: Number(r.itemId),
    itemName: r.itemName,
    type: r.type as 'box' | 'sheet' | 'sqm',
    thicknessId: Number(r.thicknessId),
    thickness: Number(r.thickness),
    variantId: Number(r.variantId),
    length: Number(r.length ?? 0),
    width: Number(r.width ?? 0),
    sheetsPerBox: Number(r.sheetsPerBox ?? 0),
    origin: r.origin ?? null,
    // Keep the frontend-friendly unified key name:
    description: {
      id: r.descId ? Number(r.descId) : null,
      itemNumber: r.itemNumber ?? null,
      categoryName: r.categoryName ?? null,
      subCategory: r.subCategory ?? null,
      colorName: r.colorName ?? null,
      designName: r.designName ?? null,
      // sortIndexRealDescription: r.sortIndexRealDescription ?? null, // if selected
    },
  }));

  return { data, page, limit, total };
}





  /**
   * Delete a whole Item tree (thicknesses + variants), then
   * delete any ItemNameDescription that became orphaned (unused by any variant).
   *
   * IMPORTANT: Descriptions are global. We only remove those that are now unused.
   */
  async deleteItemAndDescriptions(itemId: number): Promise<{ deleted: true }> {
    return this.dataSource.transaction(async (manager) => {
      // 1) Load the full graph to know which description IDs were referenced
      const item = await manager.findOne(Item, {
        where: { id: itemId },
        relations: [
          'thicknesses',
          'thicknesses.variants',
          'thicknesses.variants.itemNameDescription',
        ],
        lock: { mode: 'pessimistic_write' },
      });

      if (!item) {
        throw new NotFoundException(`Item ${itemId} not found`);
      }

      // Collect description IDs referenced by this item (deduped)
      const descIds = new Set<number>();
      for (const th of item.thicknesses ?? []) {
        for (const v of th.variants ?? []) {
          if (v.itemNameDescription?.id) descIds.add(v.itemNameDescription.id);
        }
      }

      // 2) Delete the item tree
      // If you already have ON DELETE CASCADE on FK(Thickness->Item) and FK(Variant->Thickness),
      // deleting the Item is enough. If not, do manual deletes shown below.

      // ---- Option A: rely on cascades (recommended if configured) ----
      await manager.remove(Item, item);

      // ---- Option B: manual (uncomment if you do not have FK cascades) ----
      // const thicknessIds = item.thicknesses?.map((t) => t.id) ?? [];
      // if (thicknessIds.length) {
      //   await manager.delete(ItemVariant, { thickness: In(thicknessIds) });
      //   await manager.delete(Thickness, { id: In(thicknessIds) });
      // }
      // await manager.delete(Item, { id: itemId });

      // 3) Clean up orphan descriptions (only those we collected from this item)
      if (descIds.size > 0) {
        const ids = Array.from(descIds);
        // For each candidate description, check if any variant still references it
        // If none, delete the description.
        // (Do this in batches to keep it efficient.)

        // Check left joins count for each id
        const stillUsed = await manager
          .createQueryBuilder(ItemVariant, 'v')
          .select('v.itemNameDescriptionId', 'id')
          .addSelect('COUNT(*)', 'cnt')
          .where('v.itemNameDescriptionId IN (:...ids)', { ids })
          .groupBy('v.itemNameDescriptionId')
          .getRawMany<{ id: number; cnt: string }>();

        const usedMap = new Map<number, number>();
        for (const row of stillUsed) {
          usedMap.set(Number(row.id), Number(row.cnt));
        }

        const toDelete: number[] = [];
        for (const id of ids) {
          const cnt = usedMap.get(id) ?? 0;
          if (cnt === 0) toDelete.push(id);
        }

        if (toDelete.length > 0) {
          await manager.delete(ItemNameDescription, { id: In(toDelete) });
        }
      }

      return { deleted: true };
    });
  }








  /** Create one "Clean" batch with empty date for the given variantId. Idempotent unless force=true. */
async createCleanBatchForVariant(variantId: number, opts?: { force?: boolean }) {
  const force = !!opts?.force;

  const variant = await this.itemVariantRepository.findOne({
    where: { id: variantId },
    select: ['id'],
  });
  if (!variant) {
    throw new NotFoundException(`ItemVariant ${variantId} not found`);
  }

  if (!force) {
    const exists = await this.itemBatchRepository.findOne({
      where: {
        itemVariant: { id: variantId } as any,
        condition: 'Clean',
        dateReceived: null as any,
      },
      select: ['id'],
    });
    if (exists) {
      return { created: false, batchId: exists.id, variantId };
    }
  }

  const batch = this.itemBatchRepository.create({
    itemVariant: { id: variantId } as any,
    condition: 'Clean',
    dateReceived: null,        // empty
    start: 0,
    in: 0,
    out: 0,
    balance: 0,
    startOFR: 0,
    inOFR: 0,
    outOFR: 0,
    balanceOFR: 0,
  });

  const saved = await this.itemBatchRepository.save(batch);
  return { created: true, batchId: saved.id, variantId };
}

/** Bulk create "Clean" batches for multiple variantIds (idempotent unless force=true). */
async createCleanBatchesForVariants(variantIds: number[], opts?: { force?: boolean }) {
  const force = !!opts?.force;
  const uniq = Array.from(new Set((variantIds || []).map(Number).filter(Number.isFinite)));
  if (uniq.length === 0) {
    return { created: 0, skipped: 0, results: [] as Array<{ variantId:number; batchId:number|null; created:boolean }> };
  }

  // Validate existence
  const existingVariants = await this.itemVariantRepository.find({
    where: { id: In(uniq) },
    select: ['id'],
  });
  const existingSet = new Set(existingVariants.map(v => v.id));
  const missing = uniq.filter(id => !existingSet.has(id));
  if (missing.length) {
    throw new NotFoundException(`These variantIds do not exist: ${missing.join(', ')}`);
  }

  // If not forcing, find ones that already have a Clean/null-date batch
  let skipSet = new Set<number>();
  if (!force) {
    const already = await this.itemBatchRepository.find({
      where: {
        itemVariant: In(uniq) as any,
        condition: 'Clean',
        dateReceived: null as any,
      },
      relations: ['itemVariant'],
      select: ['id', 'itemVariant'],
    });
    skipSet = new Set(already.map(r => (r as any).itemVariant.id));
  }

  const toCreate = uniq.filter(id => force || !skipSet.has(id));
  const creations = toCreate.map(variantId =>
    this.itemBatchRepository.create({
      itemVariant: { id: variantId } as any,
      condition: 'Clean',
      dateReceived: null,
      start: 0, in: 0, out: 0, balance: 0,
      startOFR: 0, inOFR: 0, outOFR: 0, balanceOFR: 0,
    })
  );

  const saved = creations.length ? await this.itemBatchRepository.save(creations) : [];

  // Build result map
  const savedByVariant = new Map<number, number>();
  saved.forEach(b => savedByVariant.set((b as any).itemVariant.id, b.id));

  const results = uniq.map(variantId => ({
    variantId,
    created: savedByVariant.has(variantId),
    batchId: savedByVariant.get(variantId) ?? null,
  }));

  const created = results.filter(r => r.created).length;
  const skipped = results.length - created;

  return { created, skipped, results };
}

/** Create Clean batch for every variant of one Item (by itemId). */
async createCleanBatchesForItem(itemId: number, opts?: { force?: boolean }) {
  // get all variant IDs under this item
  const rows = await this.itemVariantRepository.createQueryBuilder('v')
    .innerJoin('v.thickness', 't')
    .innerJoin('t.item', 'i')
    .where('i.id = :itemId', { itemId })
    .select(['v.id AS id'])
    .getRawMany<{ id: number }>();

  if (!rows.length) {
    throw new NotFoundException(`Item ${itemId} not found or has no variants`);
  }
  return this.createCleanBatchesForVariants(rows.map(r => Number(r.id)), opts);
}

/** Create Clean batch for **all** item variants in the system. */
async createCleanBatchesForAll(opts?: { force?: boolean }) {
  const rows = await this.itemVariantRepository.createQueryBuilder('v')
    .select(['v.id AS id'])
    .getRawMany<{ id: number }>();
  if (!rows.length) return { created: 0, skipped: 0, results: [] as any[] };
  return this.createCleanBatchesForVariants(rows.map(r => Number(r.id)), opts);
}






async getVariantLedger(params?: {
  q?: string; // free-text query "5.5ملم ابيض 225*321-025"
  itemName?: string;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  thickness?: number;
  length?: number;
  width?: number;
  sheetsPerBox?: number;
  origin?: string;
  page?: number;
  limit?: number;
  variantIds?: number[];
}) {
  // ---------- local helpers ----------
  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const ARABIC_INDIC_MAP: Record<string, string> = {
    '٠': '0','١': '1','٢': '2','٣': '3','٤': '4','٥': '5','٦': '6','٧': '7','٨': '8','٩': '9',
    '۰': '0','۱': '1','۲': '2','۳': '3','۴': '4','۵': '5','۶': '6','۷': '7','۸': '8','۹': '9',
  };
  const normalizeDigitsAll = (input: string) =>
    String(input || '').replace(/[٠-٩۰-۹]/g, d => ARABIC_INDIC_MAP[d] ?? d);

  const normalizeArabicAlef = (s: string) =>
    String(s || '').replace(/أ|إ|آ/g, 'ا');

  const parseVariantQuery = (qRaw: string): {
    thickness?: number;
    length?: number;
    width?: number;
    sheetsPerBox?: number;
    nameTokens?: string[];
  } => {
    if (!qRaw) return {};
    let q = normalizeDigitsAll(qRaw).trim().replace(/\s+/g, ' ');
    let working = q;

    // thickness: 5.5ملم / 5,5 ملم / 5 ملم / 5مم
    const thMatch = working.match(/(\d+(?:[.,]\d+)?)\s*(?:ملم|مم|م)\b/);
    let thickness: number | undefined;
    if (thMatch) {
      const th = Number((thMatch[1] || '').replace(',', '.'));
      if (Number.isFinite(th)) thickness = th;
      working = working.replace(thMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

    // dimensions + optional sheets per box: 225*321-025 | 225×321 | 225x321-25
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

    // leftover words → item name tokens
    working = working.replace(/\b(?:ملم|مم|م)\b/g, ' ').replace(/\s+/g, ' ').trim();
    let nameTokens: string[] | undefined;
    if (working) {
      const tokens = working
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 2);
      if (tokens.length) nameTokens = tokens;
    }

    return { thickness, length: lengthN, width: widthN, sheetsPerBox: spb, nameTokens };
  };

  // sqm → units
  const convertFromSqm = (args: {
    itemType: string | null | undefined;
    lengthCm: number;
    widthCm: number;
    sheetsPerBox: number;
    valueSqm: number;
  }) => {
    const { itemType, lengthCm, widthCm, sheetsPerBox, valueSqm } = args;
    const perSheetSqm =
      toNum(lengthCm) > 0 && toNum(widthCm) > 0
        ? (toNum(lengthCm) * toNum(widthCm)) / 10000
        : 0;
    const type = String(itemType || '').toLowerCase();

    if (type === 'box') {
      const perBoxSqm = perSheetSqm * Math.max(1, toNum(sheetsPerBox));
      return perBoxSqm > 0 ? valueSqm / perBoxSqm : valueSqm;
    }
    if (type === 'sheet') {
      return perSheetSqm > 0 ? valueSqm / perSheetSqm : valueSqm;
    }
    return valueSqm; // 'sqm' or 'unit'
  };

  // ---------- paging ----------
  const page  = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(params?.limit ?? 50)));
  const skip  = (page - 1) * limit;

  // ---------- query builder ----------
  const qb = this.itemVariantRepository
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoinAndSelect('v.batches', 'b')
    // Require a real description
    .innerJoinAndSelect('v.realDescription', 'r')
    .select([
      // variant
      'v.id',
      'v.length',
      'v.width',
      'v.sheetsPerBox',
      'v.origin',
      'v.totalStart',
      'v.totalIn',
      'v.totalOut',
      'v.totalBalance',
      'v.totalStartOFR',
      'v.totalInOFR',
      'v.totalOutOFR',
      'v.totalBalanceOFR',
      // thickness
      't.id',
      't.thickness',
      't.sort_index',
      // item
      'i.id',
      'i.itemName',
      'i.type',
      // batches
      'b.id',
      'b.condition',
      'b.dateReceived',
      'b.start',
      'b.in',
      'b.out',
      'b.balance',
      'b.startOFR',
      'b.inOFR',
      'b.outOFR',
      'b.balanceOFR',
      // real description
      'r.id',
      'r.sort_index_real_description',
      'r.categoryName',
      'r.subCategory',
      'r.colorName',
      'r.designName',
      'r.itemNumber',
    ]);

  // Optional: restrict to specific variant ids
  if (params?.variantIds && params.variantIds.length > 0) {
    qb.andWhere('v.id IN (:...vids)', { vids: params.variantIds });
  }

  // ---------- free-text q parsing ----------
  if (params?.q) {
    const parsed = parseVariantQuery(params.q);

    if (Number.isFinite(parsed.thickness)) {
      qb.andWhere('ABS(t.thickness - :pth) < 0.011', { pth: Number(parsed.thickness) });
    }
    if (Number.isFinite(parsed.length)) {
      qb.andWhere('v.length = :plen', { plen: Number(parsed.length) });
    }
    if (Number.isFinite(parsed.width)) {
      qb.andWhere('v.width = :pwid', { pwid: Number(parsed.width) });
    }
    if (Number.isFinite(parsed.sheetsPerBox)) {
      qb.andWhere('v.sheetsPerBox = :pspb', { pspb: Number(parsed.sheetsPerBox) });
    }
    if (parsed.nameTokens?.length) {
      parsed.nameTokens.forEach((tok, idx) => {
        const tokenNorm = `%${normalizeArabicAlef(tok)}%`;
        const tokenRaw  = `%${tok}%`;
        qb.andWhere(
          `(REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx} OR i.itemName LIKE :tokR${idx})`,
          { [`tokN${idx}`]: tokenNorm, [`tokR${idx}`]: tokenRaw }
        );
      });
    }
  }

  // ---------- explicit filters ----------
  if (params?.itemName) {
    const nm = normalizeArabicAlef(params.itemName);
    qb.andWhere(
      `(REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :nm OR i.itemName LIKE :nmRaw)`,
      { nm: `%${nm}%`, nmRaw: `%${params.itemName}%` }
    );
  }
  if (params?.type) qb.andWhere('i.type = :tp', { tp: params.type });
  if (Number.isFinite(params?.thickness)) qb.andWhere('ABS(t.thickness - :th) < 0.011', { th: Number(params!.thickness) });
  if (Number.isFinite(params?.length)) qb.andWhere('v.length = :len', { len: Number(params!.length) });
  if (Number.isFinite(params?.width)) qb.andWhere('v.width = :wid', { wid: Number(params!.width) });
  if (Number.isFinite(params?.sheetsPerBox)) qb.andWhere('v.sheetsPerBox = :spb', { spb: Number(params!.sheetsPerBox) });
  if (params?.origin) qb.andWhere('v.origin = :org', { org: params.origin });

  // ---------- ORDERING ----------
  // NULLS LAST for r.sort_index_real_description via computed column r_nulls
  qb
    .addSelect('CASE WHEN r.sort_index_real_description IS NULL THEN 1 ELSE 0 END', 'r_nulls')
    .addSelect('CASE WHEN t.sort_index IS NULL THEN 1 ELSE 0 END', 't_nulls')
    // 1) RealDescription: non-null first, sorted by sort_index_real_description, then r.id
    .orderBy('r_nulls', 'ASC')
    .addOrderBy('r.sort_index_real_description', 'ASC')
    .addOrderBy('r.id', 'ASC')
    // 2) Thickness: non-null sort_index first, then sort_index, then thickness
    .addOrderBy('t_nulls', 'ASC')
    .addOrderBy('t.sort_index', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    // 3) Dimensions: length only
    .addOrderBy('v.length', 'ASC')
    // Stable tie-breaker
    .addOrderBy('v.id', 'ASC')
    .skip(skip)
    .take(limit);

  // fetch
  const variants = await qb.getMany();

  // ---------- Response mapping ----------
  const data = variants.map((v) => {
    const itemType = v.thickness.item.type;
    const len = toNum(v.length);
    const wid = toNum(v.width);
    const spb = Math.max(1, toNum(v.sheetsPerBox));

    const ofrTotalsUnits = {
      start: Number(
        convertFromSqm({
          itemType,
          lengthCm: len,
          widthCm: wid,
          sheetsPerBox: spb,
          valueSqm: toNum(v.totalStartOFR ?? 0),
        }).toFixed(2)
      ),
      in: Number(
        convertFromSqm({
          itemType,
          lengthCm: len,
          widthCm: wid,
          sheetsPerBox: spb,
          valueSqm: toNum(v.totalInOFR ?? 0),
        }).toFixed(2)
      ),
      out: Number(
        convertFromSqm({
          itemType,
          lengthCm: len,
          widthCm: wid,
          sheetsPerBox: spb,
          valueSqm: toNum(v.totalOutOFR ?? 0),
        }).toFixed(2)
      ),
      balance: Number(
        convertFromSqm({
          itemType,
          lengthCm: len,
          widthCm: wid,
          sheetsPerBox: spb,
          valueSqm: toNum(v.totalBalanceOFR ?? 0),
        }).toFixed(2)
      ),
    };

    const batches = (v.batches ?? []).map((b) => {
      const balanceOFRSqm = toNum(b.balanceOFR ?? 0);
      const convertedUnits = convertFromSqm({
        itemType,
        lengthCm: len,
        widthCm: wid,
        sheetsPerBox: spb,
        valueSqm: balanceOFRSqm,
      });

      return {
        id: b.id,
        condition: b.condition ?? null,
        dateReceived: b.dateReceived ?? null,

        start: toNum(b.start ?? 0),
        in: toNum(b.in ?? 0),
        out: toNum(b.out ?? 0),
        balance: toNum(b.balance ?? 0),

        startOFR: Number(toNum(b.startOFR ?? 0).toFixed(2)),
        inOFR: Number(toNum(b.inOFR ?? 0).toFixed(2)),
        outOFR: Number(toNum(b.outOFR ?? 0).toFixed(2)),
        balanceOFRSqm: Number(balanceOFRSqm.toFixed(2)),

        // converted to unit quantity (box/sheet count or sqm)
        balanceOFR: Number(convertedUnits.toFixed(2)),
      };
    });

    const rd: any = (v as any).realDescription;

    return {
      itemId: v.thickness.item.id,
      itemName: v.thickness.item.itemName,
      type: itemType as 'box' | 'sheet' | 'sqm' | 'unit',

      thicknessId: v.thickness.id,
      thickness: Number(v.thickness.thickness),

      variantId: v.id,
      length: len,
      width: wid,
      sheetsPerBox: spb,
      origin: v.origin,

      ones: {
        start: Number(v.totalStart ?? 0),
        in: Number(v.totalIn ?? 0),
        out: Number(v.totalOut ?? 0),
        balance: Number(v.totalBalance ?? 0),
      },

      ofrTotalsSqm: {
        startOFR: Number(toNum(v.totalStartOFR ?? 0).toFixed(2)),
        inOFR: Number(toNum(v.totalInOFR ?? 0).toFixed(2)),
        outOFR: Number(toNum(v.totalOutOFR ?? 0).toFixed(2)),
        balanceOFR: Number(toNum(v.totalBalanceOFR ?? 0).toFixed(2)),
      },

      ofrTotalsUnits,

      description: {
        id: rd.id ?? null,
        categoryName: rd.categoryName ?? null,
        subCategory:  rd.subCategory ?? null,
        colorName:    rd.colorName ?? null,
        designName:   rd.designName ?? null,
        sortIndexDescription: rd.sort_index_real_description ?? null,
        itemNumber:  rd.itemNumber ?? null,
      },

      batches,
    };
  });

  return {
    page,
    limit,
    totalRows: data.length,
    hasMore: data.length === limit,
    data,
  };
}





async getVariantLedgerByItemNameDesc(params?: {
  q?: string; // "5.5ملم ابيض 225*321-025"
  itemName?: string;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  thickness?: number;
  length?: number;
  width?: number;
  sheetsPerBox?: number;
  origin?: string;
  page?: number;
  limit?: number;
  variantIds?: number[];
}) {
  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const ARABIC_INDIC_MAP: Record<string, string> = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
  };
  const normalizeDigitsAll = (input: string) =>
    String(input || '').replace(/[٠-٩۰-۹]/g, d => ARABIC_INDIC_MAP[d] ?? d);

  const normalizeArabicAlef = (s: string) =>
    String(s || '').replace(/أ|إ|آ/g, 'ا');

  const parseVariantQuery = (qRaw: string): {
    thickness?: number;
    length?: number;
    width?: number;
    sheetsPerBox?: number;
    nameTokens?: string[];
  } => {
    if (!qRaw) return {};
    let q = normalizeDigitsAll(qRaw).trim().replace(/\s+/g, ' ');
    let working = q;

    const thMatch = working.match(/(\d+(?:[.,]\d+)?)\s*(?:ملم|مم|م)(?=$|\s|[-/xX×*])/);
    let thickness: number | undefined;
    if (thMatch) {
      const th = Number((thMatch[1] || '').replace(',', '.'));
      if (Number.isFinite(th)) thickness = th;
      working = working.replace(thMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

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

    working = working
      .replace(/(?:^|[\s\-_/\\])(?:ملم|مم|م)(?=$|[\s\-_/\\])/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let nameTokens: string[] | undefined;
    if (working) {
      const tokens = working.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2);
      if (tokens.length) nameTokens = tokens;
    }

    return { thickness, length: lengthN, width: widthN, sheetsPerBox: spb, nameTokens };
  };

  const convertFromSqm = (args: {
    itemType: string | null | undefined;
    lengthCm: number;
    widthCm: number;
    sheetsPerBox: number;
    valueSqm: number;
  }) => {
    const { itemType, lengthCm, widthCm, sheetsPerBox, valueSqm } = args;
    const perSheetSqm =
      toNum(lengthCm) > 0 && toNum(widthCm) > 0
        ? (toNum(lengthCm) * toNum(widthCm)) / 10000
        : 0;
    const type = String(itemType || '').toLowerCase();

    if (type === 'box') {
      const perBoxSqm = perSheetSqm * Math.max(1, toNum(sheetsPerBox));
      return perBoxSqm > 0 ? valueSqm / perBoxSqm : valueSqm;
    }
    if (type === 'sheet') {
      return perSheetSqm > 0 ? valueSqm / perSheetSqm : valueSqm;
    }
    return valueSqm;
  };

  const page  = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(params?.limit ?? 50)));
  const skip  = (page - 1) * limit;

  const qb = this.itemVariantRepository
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoinAndSelect('v.batches', 'b')
    .leftJoinAndSelect('v.itemNameDescription', 'n')
    .select([
      'v.id','v.length','v.width','v.sheetsPerBox','v.origin',
      'v.totalStart','v.totalIn','v.totalOut','v.totalBalance',
      'v.totalStartOFR','v.totalInOFR','v.totalOutOFR','v.totalBalanceOFR',
      't.id','t.thickness','t.sort_index',
      'i.id','i.itemName','i.type',
      'b.id','b.condition','b.dateReceived','b.start','b.in','b.out','b.balance',
      'b.startOFR','b.inOFR','b.outOFR','b.balanceOFR',
      'n.id','n.categoryName','n.subCategory','n.colorName','n.designName',
      'n.itemNumber','n.sort_index_description',
      // 👇 NEW: cost fields on ItemNameDescription
      'n.averageCostCVM','n.averageCostC','n.lastCostC','n.lastCostCVM',
    ]);

  // Keep: only rows that *have* Item-Name description appear
  qb.andWhere('n.id IS NOT NULL');

  if (params?.variantIds?.length) {
    qb.andWhere('v.id IN (:...vids)', { vids: params.variantIds });
  }

  if (params?.q) {
    const parsed = parseVariantQuery(params.q);
    if (Number.isFinite(parsed.thickness)) {
      qb.andWhere('ROUND(t.thickness, 1) = ROUND(:pth, 1)', { pth: Number(parsed.thickness) });
    }
    if (Number.isFinite(parsed.length)) qb.andWhere('v.length = :plen', { plen: Number(parsed.length) });
    if (Number.isFinite(parsed.width))  qb.andWhere('v.width  = :pwid', { pwid: Number(parsed.width) });
    if (Number.isFinite(parsed.sheetsPerBox)) qb.andWhere('v.sheetsPerBox = :pspb', { pspb: Number(parsed.sheetsPerBox) });

    if (parsed.nameTokens?.length) {
      parsed.nameTokens.forEach((tok, idx) => {
        const tokenNorm = `%${normalizeArabicAlef(tok)}%`;
        const tokenRaw  = `%${tok}%`;
        qb.andWhere(
          `(REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx} OR i.itemName LIKE :tokR${idx})`,
          { [`tokN${idx}`]: tokenNorm, [`tokR${idx}`]: tokenRaw }
        );
      });
    }
  }

  if (params?.itemName) {
    const nm = normalizeArabicAlef(params.itemName);
    qb.andWhere(
      `(REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :nm OR i.itemName LIKE :nmRaw)`,
      { nm: `%${nm}%`, nmRaw: `%${params.itemName}%` },
    );
  }
  if (params?.type) qb.andWhere('i.type = :tp', { tp: params.type });
  if (Number.isFinite(params?.thickness)) qb.andWhere('ROUND(t.thickness, 1) = ROUND(:th, 1)', { th: Number(params!.thickness) });
  if (Number.isFinite(params?.length))    qb.andWhere('v.length = :len', { len: Number(params!.length) });
  if (Number.isFinite(params?.width))     qb.andWhere('v.width  = :wid', { wid: Number(params!.width) });
  if (Number.isFinite(params?.sheetsPerBox)) qb.andWhere('v.sheetsPerBox = :spb', { spb: Number(params!.sheetsPerBox) });
  if (params?.origin) qb.andWhere('v.origin = :org', { org: params.origin });

  // 🔽 ORDERING WITH ORIGIN PRIORITY
  qb
    .addSelect('CASE WHEN n.sort_index_description IS NULL THEN 1 ELSE 0 END', 'n_nulls')
    .addSelect(
      `
      CASE
        WHEN UPPER(v.origin) = 'SISECAM' THEN 1
        WHEN UPPER(v.origin) = 'AGC' THEN 2
        WHEN UPPER(v.origin) = 'SPHINX' THEN 3
        WHEN UPPER(v.origin) = 'RIDER' THEN 4
        WHEN UPPER(v.origin) IN ('S.G','SG','S G') THEN 5
        ELSE 99
      END
      `,
      'origin_priority',
    )
    .orderBy('n_nulls', 'ASC')
    .addOrderBy('n.sort_index_description', 'ASC')
    .addOrderBy('i.itemName', 'ASC')
    .addOrderBy('t.sort_index', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('origin_priority', 'ASC')
    .addOrderBy('v.origin', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.id', 'ASC')
    .skip(skip)
    .take(limit);

  const variants = await qb.getMany();

  // ---- Enrichment pass: find BOX SPBs for same (thicknessId, length, width, origin) ----
  const thicknessIds = new Set<number>();
  const lengths = new Set<number>();
  const widths = new Set<number>();
  const origins = new Set<string>();

  for (const v of variants) {
    thicknessIds.add(v.thickness.id);
    lengths.add(toNum(v.length));
    widths.add(toNum(v.width));
    origins.add(String(v.origin || ''));
  }

  let spbRows: Array<{ tId: number; len: number; wid: number; org: string; spb: number }> = [];
  if (thicknessIds.size && lengths.size && widths.size && origins.size) {
    spbRows = await this.itemVariantRepository
      .createQueryBuilder('v2')
      .innerJoin('v2.thickness', 't2')
      .innerJoin('t2.item', 'i2')
      .select([
        't2.id AS tId',
        'v2.length AS len',
        'v2.width AS wid',
        'v2.origin AS org',
        'v2.sheetsPerBox AS spb',
      ])
      .where('i2.type = :tp', { tp: 'box' })
      .andWhere('t2.id IN (:...tids)', { tids: Array.from(thicknessIds) })
      .andWhere('v2.length IN (:...lens)', { lens: Array.from(lengths) })
      .andWhere('v2.width IN (:...wids)', { wids: Array.from(widths) })
      .andWhere('v2.origin IN (:...orgs)', { orgs: Array.from(origins) })
      .getRawMany();
  }

  const spbMap = new Map<string, Set<number>>();
  for (const r of spbRows) {
    const k = `${r.tId}|${toNum(r.len)}|${toNum(r.wid)}|${String(r.org || '')}`;
    const s = Math.max(0, toNum(r.spb));
    if (s > 0) {
      if (!spbMap.has(k)) spbMap.set(k, new Set<number>());
      spbMap.get(k)!.add(s);
    }
  }

  const data = variants.map((v) => {
    const itemType = v.thickness.item.type;
    const len = toNum(v.length);
    const wid = toNum(v.width);
    const spbSelf = Math.max(1, toNum(v.sheetsPerBox));
    const key = `${v.thickness.id}|${len}|${wid}|${String(v.origin || '')}`;
    const fromBoxSet = spbMap.get(key);
    const boxSpbList = fromBoxSet ? Array.from(fromBoxSet).sort((a,b)=>a-b) : [];
    const resolvedBoxSpb = boxSpbList.length ? boxSpbList[0] : null;

    const ofrTotalsUnits = {
      start: Number(toNum(v.totalStart).toFixed(2)),
      in: Number(toNum(v.totalIn).toFixed(2)),
      out: Number(toNum(v.totalOut).toFixed(2)),
      balance: Number(toNum(v.totalBalance).toFixed(2)),
    };

    const ofrTotalsSqm = {
      startOFR: Number(toNum(v.totalStartOFR).toFixed(2)),
      inOFR: Number(toNum(v.totalInOFR).toFixed(2)),
      outOFR: Number(toNum(v.totalOutOFR).toFixed(2)),
      balanceOFR: Number(toNum(v.totalBalanceOFR).toFixed(2)),
    };

    const batches = (v.batches ?? []).map((b) => {
      const balanceOFRSqm = toNum(b.balanceOFR ?? 0);
      const convertedUnits = convertFromSqm({
        itemType, lengthCm: len, widthCm: wid, sheetsPerBox: spbSelf, valueSqm: balanceOFRSqm,
      });
      return {
        id: b.id,
        condition: b.condition ?? null,
        dateReceived: b.dateReceived ?? null,
        start: toNum(b.start ?? 0),
        in: toNum(b.in ?? 0),
        out: toNum(b.out ?? 0),
        balance: toNum(b.balance ?? 0),
        startOFR: Number(toNum(b.startOFR ?? 0).toFixed(2)),
        inOFR: Number(toNum(b.inOFR ?? 0).toFixed(2)),
        outOFR: Number(toNum(b.outOFR ?? 0).toFixed(2)),
        balanceOFRSqm: Number(balanceOFRSqm.toFixed(2)),
        balanceOFR: Number(convertedUnits.toFixed(2)),
      };
    });

    const nd: any = (v as any).itemNameDescription ?? null;

    return {
      itemId: v.thickness.item.id,
      itemName: v.thickness.item.itemName,
      type: itemType as 'box' | 'sheet' | 'sqm' | 'unit',
      thicknessId: v.thickness.id,
      thickness: Number(v.thickness.thickness),
      variantId: v.id,
      length: len,
      width: wid,
      sheetsPerBox: spbSelf,
      origin: v.origin,
      ones: ofrTotalsUnits,
      ofrTotalsSqm,
      description: nd
        ? {
            id: nd.id ?? null,
            categoryName: nd.categoryName ?? null,
            subCategory:  nd.subCategory ?? null,
            colorName:    nd.colorName ?? null,
            designName:   nd.designName ?? null,
            sortIndexDescription: nd.sort_index_description ?? null,
            itemNumber:   nd.itemNumber ?? null,
            // 👇 NEW cost fields on description payload
            averageCostCVM: nd.averageCostCVM ?? null,
            averageCostC:   nd.averageCostC   ?? null,
            lastCostC:      nd.lastCostC      ?? null,
            lastCostCVM:    nd.lastCostCVM    ?? null,
          }
        : null,
      batches,
      boxSpbList,
      resolvedBoxSpb,
    };
  });

  return {
    page,
    limit,
    totalRows: data.length,
    hasMore: data.length === limit,
    data,
  };
}







async getVariantLedgerByRealDesc(params?: {
  q?: string; // "5.5ملم ابيض 225*321-025"
  itemName?: string;
  type?: 'box' | 'sheet' | 'sqm' | 'unit';
  thickness?: number;
  length?: number;
  width?: number;
  sheetsPerBox?: number;
  origin?: string;
  page?: number;
  limit?: number;
  variantIds?: number[];
  asOf?: string; // 'YYYY-MM-DD' (inclusive till end of day)
}) {
  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const ARABIC_INDIC_MAP: Record<string, string> = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
  };

  const normalizeDigitsAll = (input: string) =>
    String(input || '').replace(/[٠-٩۰-۹]/g, d => ARABIC_INDIC_MAP[d] ?? d);

  const normalizeArabicAlef = (s: string) =>
    String(s || '').replace(/أ|إ|آ/g, 'ا');

  const parseVariantQuery = (qRaw: string): {
    thickness?: number;
    length?: number;
    width?: number;
    sheetsPerBox?: number;
    nameTokens?: string[];
  } => {
    if (!qRaw) return {};
    let q = normalizeDigitsAll(qRaw).trim().replace(/\s+/g, ' ');
    let working = q;

    const thMatch = working.match(/(\d+(?:[.,]\d+)?)\s*(?:ملم|مم|م)(?=$|\s|[-/xX×*])/);
    let thickness: number | undefined;
    if (thMatch) {
      const th = Number((thMatch[1] || '').replace(',', '.'));
      if (Number.isFinite(th)) thickness = th;
      working = working.replace(thMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

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

    working = working
      .replace(/(?:^|[\s\-_/\\])(?:ملم|مم|م)(?=$|[\s\-_/\\])/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let nameTokens: string[] | undefined;
    if (working) {
      const tokens = working.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2);
      if (tokens.length) nameTokens = tokens;
    }

    return { thickness, length: lengthN, width: widthN, sheetsPerBox: spb, nameTokens };
  };

  const convertFromSqm = (args: {
    itemType: string | null | undefined;
    lengthCm: number;
    widthCm: number;
    sheetsPerBox: number;
    valueSqm: number;
  }) => {
    const { itemType, lengthCm, widthCm, sheetsPerBox, valueSqm } = args;
    const perSheetSqm =
      toNum(lengthCm) > 0 && toNum(widthCm) > 0
        ? (toNum(lengthCm) * toNum(widthCm)) / 10000
        : 0;
    const type = String(itemType || '').toLowerCase();

    if (type === 'box') {
      const perBoxSqm = perSheetSqm * Math.max(1, toNum(sheetsPerBox));
      return perBoxSqm > 0 ? valueSqm / perBoxSqm : valueSqm;
    }
    if (type === 'sheet') {
      return perSheetSqm > 0 ? valueSqm / perSheetSqm : valueSqm;
    }
    return valueSqm;
  };

  // ✅ asOf validation (we use YYYY-MM-DD string)
  const asOfRaw = (params?.asOf ?? '').trim();
  const asOfOk = !asOfRaw || /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw);
  if (!asOfOk) {
    throw new Error(`asOf must be YYYY-MM-DD, got: ${asOfRaw}`);
  }

  // ---- schema helpers ----
  const getTableColumns = async (tableName: string): Promise<string[]> => {
    const rows = await this.itemVariantRepository.query(
      `
      SELECT COLUMN_NAME AS col
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      `,
      [tableName],
    );
    return (rows || []).map((r: any) => String(r.col));
  };

  const resolveTable = async (candidates: string[]): Promise<string | null> => {
    for (const cand of candidates) {
      const rows = await this.itemVariantRepository.query(
        `
        SELECT TABLE_NAME AS name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        LIMIT 1
        `,
        [cand],
      );
      if (rows?.length) return String(rows[0].name);
    }
    return null;
  };

  // ---- inventory_transaction schema detection (cached) ----
  const getInvTxnColumns = async (): Promise<string[]> => {
    const cached = (this as any).__invTxnCols as string[] | undefined;
    if (cached) return cached;

    const rows = await this.itemVariantRepository.query(`
      SELECT COLUMN_NAME AS col
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_transaction'
    `);

    const cols = (rows || []).map((r: any) => String(r.col));
    (this as any).__invTxnCols = cols;
    return cols;
  };

  const pickCol = (cols: string[], candidates: string[]) => {
    const map = new Map<string, string>();
    for (const c of cols) map.set(c.toLowerCase(), c);
    for (const cand of candidates) {
      const hit = map.get(cand.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };

  const page  = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(params?.limit ?? 50)));
  const skip  = (page - 1) * limit;

  const qb = this.itemVariantRepository
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoinAndSelect('v.batches', 'b')
    .leftJoinAndSelect('v.realDescription', 'r')
    .select([
      'v.id','v.length','v.width','v.sheetsPerBox','v.origin',
      'v.totalStart','v.totalIn','v.totalOut','v.totalBalance',
      'v.totalStartOFR','v.totalInOFR','v.totalOutOFR','v.totalBalanceOFR',
      'v.averageCost','v.lastCost',
      't.id','t.thickness','t.sort_index',
      'i.id','i.itemName','i.type',
      'b.id','b.condition','b.dateReceived','b.start','b.in','b.out','b.balance',
      'b.startOFR','b.inOFR','b.outOFR','b.balanceOFR',
      'r.id','r.categoryName','r.subCategory','r.colorName','r.designName',
      'r.itemNumber','r.sort_index_real_description',
    ]);

  qb.andWhere('r.id IS NOT NULL');

  if (params?.variantIds?.length) {
    qb.andWhere('v.id IN (:...vids)', { vids: params.variantIds });
  }

  if (params?.q) {
    const parsed = parseVariantQuery(params.q);
    if (Number.isFinite(parsed.thickness)) {
      qb.andWhere('ROUND(t.thickness, 1) = ROUND(:pth, 1)', { pth: Number(parsed.thickness) });
    }
    if (Number.isFinite(parsed.length)) qb.andWhere('v.length = :plen', { plen: Number(parsed.length) });
    if (Number.isFinite(parsed.width))  qb.andWhere('v.width  = :pwid', { pwid: Number(parsed.width) });
    if (Number.isFinite(parsed.sheetsPerBox)) qb.andWhere('v.sheetsPerBox = :pspb', { pspb: Number(parsed.sheetsPerBox) });

    if (parsed.nameTokens?.length) {
      parsed.nameTokens.forEach((tok, idx) => {
        const tokenNorm = `%${normalizeArabicAlef(tok)}%`;
        const tokenRaw  = `%${tok}%`;
        qb.andWhere(
          `(
            REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx}
            OR i.itemName LIKE :tokR${idx}
            OR REPLACE(REPLACE(REPLACE(r.categoryName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx}
            OR REPLACE(REPLACE(REPLACE(r.subCategory,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx}
            OR REPLACE(REPLACE(REPLACE(r.colorName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx}
            OR REPLACE(REPLACE(REPLACE(r.designName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx}
            OR r.itemNumber LIKE :tokR${idx}
          )`,
          { [`tokN${idx}`]: tokenNorm, [`tokR${idx}`]: tokenRaw }
        );
      });
    }
  }

  if (params?.itemName) {
    const nm = normalizeArabicAlef(params.itemName);
    qb.andWhere(
      `(REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :nm OR i.itemName LIKE :nmRaw)`,
      { nm: `%${nm}%`, nmRaw: `%${params.itemName}%` },
    );
  }
  if (params?.type) qb.andWhere('i.type = :tp', { tp: params.type });
  if (Number.isFinite(params?.thickness)) qb.andWhere('ROUND(t.thickness, 1) = ROUND(:th, 1)', { th: Number(params!.thickness) });
  if (Number.isFinite(params?.length))    qb.andWhere('v.length = :len', { len: Number(params!.length) });
  if (Number.isFinite(params?.width))     qb.andWhere('v.width  = :wid', { wid: Number(params!.width) });
  if (Number.isFinite(params?.sheetsPerBox)) qb.andWhere('v.sheetsPerBox = :spb', { spb: Number(params!.sheetsPerBox) });
  if (params?.origin) qb.andWhere('v.origin = :org', { org: params.origin });

  qb
    .addSelect('CASE WHEN r.sort_index_real_description IS NULL THEN 1 ELSE 0 END', 'r_nulls')
    .addSelect(
      `
      CASE
        WHEN UPPER(v.origin) = 'SISECAM' THEN 1
        WHEN UPPER(v.origin) = 'AGC' THEN 2
        WHEN UPPER(v.origin) = 'SPHINX' THEN 3
        WHEN UPPER(v.origin) = 'RIDER' THEN 4
        WHEN UPPER(v.origin) IN ('S.G','SG','S G') THEN 5
        ELSE 99
      END
      `,
      'origin_priority',
    )
    .orderBy('r_nulls', 'ASC')
    .addOrderBy('r.sort_index_real_description', 'ASC')
    .addOrderBy('i.itemName', 'ASC')
    .addOrderBy('t.sort_index', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('origin_priority', 'ASC')
    .addOrderBy('v.origin', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.id', 'ASC')
    .skip(skip)
    .take(limit);

  const variants = await qb.getMany();

  // ✅ asOf snapshots (balances)
  const variantSnap = new Map<number, { balU?: any; balOFR?: any }>();
  const batchSnap   = new Map<number, { balU?: any; balOFR?: any }>();

  // ✅ asOf costs (purchase invoice first, then count type G)
  const costSnap = new Map<number, { avg?: number | null; last?: number | null }>();

  // collect variantIds early (used by snapshots + costs)
  const variantIds = (variants as any[]).map(v => Number(v.id)).filter(n => Number.isFinite(n) && n > 0);

  if (asOfRaw && variants.length) {
    // -------------------------------
    // 1) BALANCE snapshots from inventory_transaction (your existing logic)
    // -------------------------------
    const cols = await getInvTxnColumns();

    const hasDateForEach = !!pickCol(cols, ['dateForEachInvoice']);
    const txnDateCol = pickCol(cols, ['transactionDate']) || 'transactionDate';

    const qtyCol     = pickCol(cols, ['quantity']);
    const qtyOfrCol  = pickCol(cols, ['quantityofr', 'quantityOFR', 'quantity_ofr']);
    const sqmCol     = pickCol(cols, ['sqm']);
    const sqmOfrCol  = pickCol(cols, ['sqmofr', 'sqmOFR', 'sqm_ofr']);

    const unitExpr = qtyCol ? `SUM(COALESCE(\`${qtyCol}\`,0))` : (sqmCol ? `SUM(COALESCE(\`${sqmCol}\`,0))` : null);
    const ofrExpr  = sqmOfrCol ? `SUM(COALESCE(\`${sqmOfrCol}\`,0))` : (qtyOfrCol ? `SUM(COALESCE(\`${qtyOfrCol}\`,0))` : null);

    if (!unitExpr && !ofrExpr) {
      throw new Error(
        `inventory_transaction cannot make snapshots: missing quantity/sqm columns. Found: ${cols.join(', ')}`
      );
    }

    const dateFilterExpr = hasDateForEach
      ? `COALESCE(dateForEachInvoice, DATE(\`${txnDateCol}\`))`
      : `DATE(\`${txnDateCol}\`)`;

    const batchIds: number[] = [];
    for (const v of variants as any[]) {
      for (const b of (v.batches ?? [])) {
        const bid = Number(b?.id);
        if (Number.isFinite(bid) && bid > 0) batchIds.push(bid);
      }
    }

    const makeIn = (arr: any[]) => arr.map(() => '?').join(',');

    if (variantIds.length) {
      const sql = `
        SELECT itemVariantId AS variantId
          ${unitExpr ? `, ${unitExpr} AS balU` : ``}
          ${ofrExpr  ? `, ${ofrExpr}  AS balOFR` : ``}
        FROM inventory_transaction
        WHERE itemVariantId IN (${makeIn(variantIds)})
          AND ${dateFilterExpr} <= ?
        GROUP BY itemVariantId
      `;
      const rows = await this.itemVariantRepository.query(sql, [...variantIds, asOfRaw]);
      for (const r of rows || []) {
        const vid = Number(r.variantId);
        if (Number.isFinite(vid)) {
          variantSnap.set(vid, { balU: r.balU, balOFR: r.balOFR });
        }
      }
    }

    if (batchIds.length) {
      const uniq = Array.from(new Set(batchIds));
      const sql = `
        SELECT itemBatchId AS batchId
          ${unitExpr ? `, ${unitExpr} AS balU` : ``}
          ${ofrExpr  ? `, ${ofrExpr}  AS balOFR` : ``}
        FROM inventory_transaction
        WHERE itemBatchId IN (${makeIn(uniq)})
          AND ${dateFilterExpr} <= ?
        GROUP BY itemBatchId
      `;
      const rows = await this.itemVariantRepository.query(sql, [...uniq, asOfRaw]);
      for (const r of rows || []) {
        const bid = Number(r.batchId);
        if (Number.isFinite(bid)) {
          batchSnap.set(bid, { balU: r.balU, balOFR: r.balOFR });
        }
      }
    }

    // -------------------------------
    // 2) COST snapshots for asOf:
    //    A) last purchase invoice <= asOf
    //    B) if none => last inventory_count type G <= asOf (finalCostOfr as averageCost)
    // -------------------------------

    // A) Purchase Invoice snapshot (best-effort, schema-detected)
    const piiTable = await resolveTable([
      'purchase_invoice_item',
      'purchase_invoice_items',
      'purchaseInvoiceItem',
      'purchaseInvoiceItems',
      'purchases_invoice_item',
      'purchases_invoice_items',
    ]);

    const piTable = await resolveTable([
      'purchase_invoice',
      'purchase_invoices',
      'purchaseInvoice',
      'purchaseInvoices',
      'purchases_invoice',
      'purchases_invoices',
    ]);

    if (piiTable) {
      const piiCols = await getTableColumns(piiTable);

      const piiVariantCol = pickCol(piiCols, ['itemVariantId','item_variant_id','variantId','variant_id']);
      const piiIdCol = pickCol(piiCols, ['id']) || 'id';

      const piiInvoiceIdCol = pickCol(piiCols, [
        'purchaseInvoiceId','purchase_invoice_id',
        'invoiceId','invoice_id',
      ]);

      // average/last/cost columns (we pick what exists)
      const avgCol = pickCol(piiCols, ['averageCost','avgCost','average_cost']);
      const lastCol = pickCol(piiCols, ['lastCost','last_cost']);
      const costCol = pickCol(piiCols, ['cost','unitCost','unit_cost','price','unitPrice','unit_price','finalCost','final_cost']);

      // date can be on item if no header table is usable
      const piiDateCol = pickCol(piiCols, ['date','invoiceDate','createdAt','created_at','updatedAt','updated_at']);

      if (piiVariantCol) {
        // If we have header table + join col => use header date (more correct)
        let useJoin = false;
        let dateExpr = '';
        let joinSql = '';
        let whereDate = '';
        if (piTable && piiInvoiceIdCol) {
          const piCols = await getTableColumns(piTable);
          const piIdCol = pickCol(piCols, ['id']) || 'id';
          const piDateCol = pickCol(piCols, ['date','invoiceDate','createdAt','created_at','updatedAt','updated_at','dateForEachInvoice']);

          if (piDateCol) {
            useJoin = true;
            joinSql = `INNER JOIN \`${piTable}\` pi ON pi.\`${piIdCol}\` = pii.\`${piiInvoiceIdCol}\``;
            dateExpr = `DATE(pi.\`${piDateCol}\`)`;
            whereDate = `AND ${dateExpr} <= ?`;
          }
        }

        // fallback to item date if no join-date
        if (!useJoin) {
          if (piiDateCol) {
            dateExpr = `DATE(pii.\`${piiDateCol}\`)`;
            whereDate = `AND ${dateExpr} <= ?`;
          } else {
            // no date column found => cannot do asOf correctly, skip purchase snapshot
            dateExpr = '';
            whereDate = '';
          }
          joinSql = '';
        }

        // only run if we found a date expression (to respect asOf)
        if (dateExpr) {
          const missing = variantIds.filter(id => !costSnap.has(id));
          if (missing.length) {
            const makeIn = (arr: any[]) => arr.map(() => '?').join(',');

            const avgExpr =
              avgCol ? `pii.\`${avgCol}\`` :
              lastCol ? `pii.\`${lastCol}\`` :
              costCol ? `pii.\`${costCol}\`` :
              `NULL`;

            const lastExpr =
              lastCol ? `pii.\`${lastCol}\`` :
              costCol ? `pii.\`${costCol}\`` :
              avgCol ? `pii.\`${avgCol}\`` :
              `NULL`;

            // MySQL 8 window version
            try {
              const sql = `
                SELECT z.variantId, z.avgCost, z.lastCost
                FROM (
                  SELECT
                    pii.\`${piiVariantCol}\` AS variantId,
                    ${avgExpr}  AS avgCost,
                    ${lastExpr} AS lastCost,
                    ROW_NUMBER() OVER (
                      PARTITION BY pii.\`${piiVariantCol}\`
                      ORDER BY ${dateExpr} DESC, pii.\`${piiIdCol}\` DESC
                    ) AS rn
                  FROM \`${piiTable}\` pii
                  ${joinSql}
                  WHERE pii.\`${piiVariantCol}\` IN (${makeIn(missing)})
                  ${whereDate}
                ) z
                WHERE z.rn = 1
              `;
              const rows = await this.itemVariantRepository.query(sql, [...missing, asOfRaw]);
              for (const r of rows || []) {
                const vid = Number(r.variantId);
                if (!Number.isFinite(vid)) continue;
                const avg = r.avgCost != null ? Number(toNum(r.avgCost).toFixed(2)) : null;
                const last = r.lastCost != null ? Number(toNum(r.lastCost).toFixed(2)) : null;
                // normalize: if one is missing, copy from the other
                const avgFinal = avg != null ? avg : (last != null ? last : null);
                const lastFinal = last != null ? last : (avg != null ? avg : null);
                if (avgFinal != null || lastFinal != null) {
                  costSnap.set(vid, { avg: avgFinal, last: lastFinal });
                }
              }
            } catch {
              // MySQL 5.7 fallback: pick max(date,id) per variant using CONCAT trick
              const inMissing = makeIn(missing);
              const sql = `
                SELECT
                  pii.\`${piiVariantCol}\` AS variantId,
                  ${avgExpr}  AS avgCost,
                  ${lastExpr} AS lastCost
                FROM \`${piiTable}\` pii
                ${joinSql}
                INNER JOIN (
                  SELECT
                    pii2.\`${piiVariantCol}\` AS variantId,
                    MAX(CONCAT(
                      DATE_FORMAT(${dateExpr}, '%Y%m%d%H%i%s'),
                      '-',
                      LPAD(pii2.\`${piiIdCol}\`, 10, '0')
                    )) AS mx
                  FROM \`${piiTable}\` pii2
                  ${joinSql ? joinSql.replace(/pii\./g, 'pii2.').replace(/ pi /g, ' pi2 ') : ''}
                  WHERE pii2.\`${piiVariantCol}\` IN (${inMissing})
                  ${whereDate ? whereDate.replace(/pi\./g, 'pi2.').replace(/pii\./g, 'pii2.') : ''}
                  GROUP BY pii2.\`${piiVariantCol}\`
                ) t
                  ON t.variantId = pii.\`${piiVariantCol}\`
                 AND t.mx = CONCAT(
                      DATE_FORMAT(${dateExpr}, '%Y%m%d%H%i%s'),
                      '-',
                      LPAD(pii.\`${piiIdCol}\`, 10, '0')
                    )
              `;
              const rows = await this.itemVariantRepository.query(sql, [...missing, asOfRaw]);
              for (const r of rows || []) {
                const vid = Number(r.variantId);
                if (!Number.isFinite(vid)) continue;
                const avg = r.avgCost != null ? Number(toNum(r.avgCost).toFixed(2)) : null;
                const last = r.lastCost != null ? Number(toNum(r.lastCost).toFixed(2)) : null;
                const avgFinal = avg != null ? avg : (last != null ? last : null);
                const lastFinal = last != null ? last : (avg != null ? avg : null);
                if (avgFinal != null || lastFinal != null) {
                  costSnap.set(vid, { avg: avgFinal, last: lastFinal });
                }
              }
            }
          }
        }
      }
    }

    // B) Fallback to inventory_count type G (YOUR ENTITY: inventory_count has itemVariantId/date/type/finalCostOfr)
    const missingAfterPurchase = variantIds.filter(id => !costSnap.has(id));
    if (missingAfterPurchase.length) {
      const makeIn = (arr: any[]) => arr.map(() => '?').join(',');

      // MySQL 8 window version
      try {
        const sql = `
          SELECT z.variantId, z.avgCost
          FROM (
            SELECT
              ic.itemVariantId AS variantId,
              ic.finalCostOfr  AS avgCost,
              ROW_NUMBER() OVER (
                PARTITION BY ic.itemVariantId
                ORDER BY ic.date DESC, ic.id DESC
              ) AS rn
            FROM inventory_count ic
            WHERE ic.itemVariantId IN (${makeIn(missingAfterPurchase)})
              AND ic.type = 'G'
              AND ic.date <= ?
          ) z
          WHERE z.rn = 1
        `;
        const rows = await this.itemVariantRepository.query(sql, [...missingAfterPurchase, asOfRaw]);
        for (const r of rows || []) {
          const vid = Number(r.variantId);
          if (!Number.isFinite(vid)) continue;
          const avg = r.avgCost != null ? Number(toNum(r.avgCost).toFixed(2)) : null;
          if (avg != null) {
            // averageCost comes from count G finalCostOfr
            costSnap.set(vid, { avg, last: null });
          }
        }
      } catch {
        // MySQL 5.7 fallback
        const sql = `
          SELECT
            ic.itemVariantId AS variantId,
            ic.finalCostOfr  AS avgCost
          FROM inventory_count ic
          INNER JOIN (
            SELECT
              itemVariantId,
              MAX(CONCAT(
                DATE_FORMAT(date, '%Y%m%d'),
                '-',
                LPAD(id, 10, '0')
              )) AS mx
            FROM inventory_count
            WHERE itemVariantId IN (${makeIn(missingAfterPurchase)})
              AND type = 'G'
              AND date <= ?
            GROUP BY itemVariantId
          ) t
            ON t.itemVariantId = ic.itemVariantId
           AND t.mx = CONCAT(
                DATE_FORMAT(ic.date, '%Y%m%d'),
                '-',
                LPAD(ic.id, 10, '0')
              )
        `;
        const rows = await this.itemVariantRepository.query(sql, [...missingAfterPurchase, asOfRaw]);
        for (const r of rows || []) {
          const vid = Number(r.variantId);
          if (!Number.isFinite(vid)) continue;
          const avg = r.avgCost != null ? Number(toNum(r.avgCost).toFixed(2)) : null;
          if (avg != null) {
            costSnap.set(vid, { avg, last: null });
          }
        }
      }
    }
  }

  // ---- Enrichment pass (SPB list) ----
  const thicknessIds = new Set<number>();
  const lengths = new Set<number>();
  const widths = new Set<number>();
  const origins = new Set<string>();

  for (const v of variants as any[]) {
    thicknessIds.add(v.thickness.id);
    lengths.add(toNum(v.length));
    widths.add(toNum(v.width));
    origins.add(String(v.origin || ''));
  }

  let spbRows: Array<{ tId: number; len: number; wid: number; org: string; spb: number }> = [];
  if (thicknessIds.size && lengths.size && widths.size && origins.size) {
    spbRows = await this.itemVariantRepository
      .createQueryBuilder('v2')
      .innerJoin('v2.thickness', 't2')
      .innerJoin('t2.item', 'i2')
      .select([
        't2.id AS tId',
        'v2.length AS len',
        'v2.width AS wid',
        'v2.origin AS org',
        'v2.sheetsPerBox AS spb',
      ])
      .where('i2.type = :tp', { tp: 'box' })
      .andWhere('t2.id IN (:...tids)', { tids: Array.from(thicknessIds) })
      .andWhere('v2.length IN (:...lens)', { lens: Array.from(lengths) })
      .andWhere('v2.width IN (:...wids)', { wids: Array.from(widths) })
      .andWhere('v2.origin IN (:...orgs)', { orgs: Array.from(origins) })
      .getRawMany();
  }

  const spbMap = new Map<string, Set<number>>();
  for (const r of spbRows) {
    const k = `${r.tId}|${toNum(r.len)}|${toNum(r.wid)}|${String(r.org || '')}`;
    const s = Math.max(0, toNum(r.spb));
    if (s > 0) {
      if (!spbMap.has(k)) spbMap.set(k, new Set<number>());
      spbMap.get(k)!.add(s);
    }
  }

  const data = (variants as any[]).map((v) => {
    const itemType = v.thickness.item.type;
    const len = toNum(v.length);
    const wid = toNum(v.width);
    const spbSelf = Math.max(1, toNum(v.sheetsPerBox));
    const key = `${v.thickness.id}|${len}|${wid}|${String(v.origin || '')}`;
    const fromBoxSet = spbMap.get(key);
    const boxSpbList = fromBoxSet ? Array.from(fromBoxSet).sort((a,b)=>a-b) : [];
    const resolvedBoxSpb = boxSpbList.length ? boxSpbList[0] : null;

    const snap = asOfRaw ? variantSnap.get(Number(v.id)) : null;

    const ofrTotalsUnits = {
      start:  Number(toNum(v.totalStart).toFixed(2)),
      in:     Number(toNum(v.totalIn).toFixed(2)),
      out:    Number(toNum(v.totalOut).toFixed(2)),
      balance: Number(toNum(snap?.balU ?? v.totalBalance).toFixed(2)),
    };

    const ofrTotalsSqm = {
      startOFR:   Number(toNum(v.totalStartOFR).toFixed(2)),
      inOFR:      Number(toNum(v.totalInOFR).toFixed(2)),
      outOFR:     Number(toNum(v.totalOutOFR).toFixed(2)),
      balanceOFR: Number(toNum(snap?.balOFR ?? v.totalBalanceOFR).toFixed(2)),
    };

    const batches = (v.batches ?? []).map((b) => {
      const bSnap = asOfRaw ? batchSnap.get(Number(b.id)) : null;

      const balanceOFRSqm = toNum(bSnap?.balOFR ?? (b.balanceOFR ?? 0));
      const convertedUnits = convertFromSqm({
        itemType, lengthCm: len, widthCm: wid, sheetsPerBox: spbSelf, valueSqm: balanceOFRSqm,
      });

      return {
        id: b.id,
        condition: b.condition ?? null,
        dateReceived: b.dateReceived ?? null,
        start: toNum(b.start ?? 0),
        in: toNum(b.in ?? 0),
        out: toNum(b.out ?? 0),
        balance: toNum(bSnap?.balU ?? (b.balance ?? 0)),
        startOFR: Number(toNum(b.startOFR ?? 0).toFixed(2)),
        inOFR: Number(toNum(b.inOFR ?? 0).toFixed(2)),
        outOFR: Number(toNum(b.outOFR ?? 0).toFixed(2)),
        balanceOFRSqm: Number(balanceOFRSqm.toFixed(2)),
        balanceOFR: Number(convertedUnits.toFixed(2)),
      };
    });

    const rd: any = (v as any).realDescription ?? null;

    // ✅ cost override for asOf
    const c = asOfRaw ? costSnap.get(Number(v.id)) : null;
    const avgOut =
      asOfRaw
        ? (c?.avg != null ? c.avg : (v.averageCost != null ? Number(toNum(v.averageCost).toFixed(2)) : null))
        : (v.averageCost != null ? Number(toNum(v.averageCost).toFixed(2)) : null);

    const lastOut =
      asOfRaw
        ? (c?.last != null ? c.last : (v.lastCost != null ? Number(toNum(v.lastCost).toFixed(2)) : null))
        : (v.lastCost != null ? Number(toNum(v.lastCost).toFixed(2)) : null);

    return {
      itemId: v.thickness.item.id,
      itemName: v.thickness.item.itemName,
      type: itemType as 'box' | 'sheet' | 'sqm' | 'unit',
      thicknessId: v.thickness.id,
      thickness: Number(v.thickness.thickness),
      variantId: v.id,
      length: len,
      width: wid,
      sheetsPerBox: spbSelf,
      origin: v.origin,

      ones: ofrTotalsUnits,
      ofrTotalsSqm,

      description: rd
        ? {
            id: rd.id ?? null,
            categoryName: rd.categoryName ?? null,
            subCategory:  rd.subCategory ?? null,
            colorName:    rd.colorName ?? null,
            designName:   rd.designName ?? null,
            sortIndexRealDescription: rd.sort_index_real_description ?? null,
            itemNumber:   rd.itemNumber ?? null,
          }
        : null,

      batches,
      boxSpbList,
      resolvedBoxSpb,

      averageCost: avgOut,
      lastCost: lastOut,
    };
  });

  return {
    page,
    limit,
    totalRows: data.length,
    hasMore: data.length === limit,
    data,
  };
}


















// GET /item-descriptions
  async listSorted(opts: { q?: string; withCounts?: boolean }) {
    const qb = this.ds.getRepository(ItemNameDescription)
      .createQueryBuilder('d')
      .select([
        'd.id',
         'd.itemNumber',  
        'd.categoryName',
        'd.subCategory',
        'd.colorName',
        'd.designName',
        'd.sort_index_description',
      ])
      // non-null first (0), nulls last (1)
      .addOrderBy('CASE WHEN d.sort_index_description IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('d.sort_index_description', 'ASC')
      // readable tie-breaker
      .addOrderBy(
        `CONCAT(
           COALESCE(d.categoryName,''),'|',
           COALESCE(d.subCategory,''),'|',
           COALESCE(d.colorName,''),'|',
           COALESCE(d.designName,''),'|',
           COALESCE(d.itemNumber,'')      
         )`,
        'ASC',
      );

    if (opts.q) {
      qb.andWhere(
        `CONCAT(
           COALESCE(d.categoryName,''),' ',
           COALESCE(d.subCategory,''),' ',
           COALESCE(d.colorName,''),' ',
           COALESCE(d.designName,''),' ',
           COALESCE(d.itemNumber,'')   
         ) LIKE :q`,
        { q: `%${opts.q}%` },
      );
    }

    const rows = await qb.getMany();

    if (!opts.withCounts) return rows;

    // count variants per description (single grouped query)
    const counts = await this.ds.getRepository(ItemVariant)
      .createQueryBuilder('v')
      .select('v.itemNameDescriptionId', 'descId')
      .addSelect('COUNT(1)', 'cnt')
      .where('v.itemNameDescriptionId IS NOT NULL')
      .groupBy('v.itemNameDescriptionId')
      .getRawMany<{ descId: number; cnt: string }>();

    const map = new Map<number, number>();
    for (const r of counts) map.set(Number(r.descId), Number(r.cnt));

    return rows.map((r) => ({
      ...r,
      // keep property names as in entity (snake for sort index)
      variantsCount: map.get(r.id) ?? 0,
    }));
  }

  // PUT /item-descriptions/reorder
  async reorder(order?: any) {
    if (!Array.isArray(order) || order.length === 0) {
      throw new BadRequestException('Body must be { order: number[] } with at least one id.');
    }
    // sanitize & dedupe
    const ids = order.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    const unique = Array.from(new Set(ids));
    if (unique.length !== ids.length) {
      throw new BadRequestException('Order array contains duplicates or invalid values.');
    }

    const repo = this.ds.getRepository(ItemNameDescription);
    const existing = await repo.find({ select: ['id'], where: { id: In(unique) } });
    const existingIds = new Set(existing.map((e) => e.id));
    const missing = unique.filter((id) => !existingIds.has(id));
    if (missing.length) {
      throw new BadRequestException(`These IDs do not exist: ${missing.join(', ')}`);
    }

    // Transactionally write 1..N using a CASE update
    await this.ds.transaction(async (manager) => {
      const cases = unique.map((id, idx) => `WHEN ${id} THEN ${idx + 1}`).join(' ');
      await manager
        .createQueryBuilder()
        .update(ItemNameDescription)
        .set({
          // use the exact property name you have in the entity
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sort_index_description: () => `CASE id ${cases} END` as any,
        })
        .where('id IN (:...ids)', { ids: unique })
        .execute();
    });
  }



   async fetchDescriptionVariants(opts: {
    descId: number;
    page?: number;
    limit?: number;
    q?: string;
  }) {
    const page  = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.min(1000, Math.max(1, Number(opts.limit ?? 500)));
    const skip  = (page - 1) * limit;

    const qb = this.itemVariantRepository
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.thickness', 't')
      .innerJoinAndSelect('t.item', 'i')
      .leftJoinAndSelect('v.itemNameDescription', 'd')
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
        'd.id',
      ])
      .where('v.itemNameDescriptionId = :descId', { descId: opts.descId });

    // optional free-text filter on item name / origin (simple and fast)
    if (opts.q) {
      const q = `%${opts.q}%`;
      qb.andWhere(
        `(i.itemName LIKE :q OR v.origin LIKE :q)`,
        { q },
      );
    }

    // ORDER: Item → Thickness → Length → Width → Origin → v.id
    qb
      .orderBy('i.itemName', 'ASC')
      .addOrderBy('t.thickness', 'ASC')
      .addOrderBy('v.length', 'ASC')
      .addOrderBy('v.width', 'ASC')
      .addOrderBy('v.origin', 'ASC')
      .addOrderBy('v.id', 'ASC')
      .skip(skip)
      .take(limit);

    // fetch both rows and total for pagination
    const [rows, total] = await qb.getManyAndCount();

    const data = rows.map((v) => ({
      variantId: v.id,
      itemName: v.thickness.item.itemName,
      thickness: Number(v.thickness.thickness),
      length: Number(v.length ?? 0),
      width: Number(v.width ?? 0),
      sheetsPerBox: Number(v.sheetsPerBox ?? 0),
      origin: v.origin ?? null,
      // You can add more fields later (type, ids, etc.)
    }));

    return {
      page,
      limit,
      total,
      hasMore: skip + data.length < total,
      data,
    };
  }






// ================== REAL DESCRIPTIONS ==================

/** GET /items/real-descriptions */
async listSortedReal(opts: { q?: string; withCounts?: boolean }) {
  const qb = this.ds.getRepository(RealDescription)
    .createQueryBuilder('r')
    .select([
      'r.id',
      'r.itemNumber',
      'r.categoryName',
      'r.subCategory',
      'r.colorName',
      'r.designName',
      'r.sort_index_real_description',
    ])
    // non-null first (0), nulls last (1)
    .addOrderBy('CASE WHEN r.sort_index_real_description IS NULL THEN 1 ELSE 0 END', 'ASC')
    .addOrderBy('r.sort_index_real_description', 'ASC')
    // readable tie-breaker
    .addOrderBy(
      `CONCAT(
         COALESCE(r.categoryName,''),'|',
         COALESCE(r.subCategory,''),'|',
         COALESCE(r.colorName,''),'|',
         COALESCE(r.designName,''),'|',
         COALESCE(r.itemNumber,'')
       )`,
      'ASC',
    );

  if (opts.q) {
    qb.andWhere(
      `CONCAT(
         COALESCE(r.categoryName,''),' ',
         COALESCE(r.subCategory,''),' ',
         COALESCE(r.colorName,''),' ',
         COALESCE(r.designName,''),' ',
         COALESCE(r.itemNumber,'')
       ) LIKE :q`,
      { q: `%${opts.q}%` },
    );
  }

  const rows = await qb.getMany();

  if (!opts.withCounts) return rows;

  // count variants per REAL description (single grouped query)
  const counts = await this.itemVariantRepository
    .createQueryBuilder('v')
    .select('v.realDescriptionId', 'descId')
    .addSelect('COUNT(1)', 'cnt')
    .where('v.realDescriptionId IS NOT NULL')
    .groupBy('v.realDescriptionId')
    .getRawMany<{ descId: number; cnt: string }>();

  const map = new Map<number, number>();
  for (const r of counts) map.set(Number(r.descId), Number(r.cnt));

  return rows.map((r) => ({
    ...r,
    variantsCount: map.get(r.id) ?? 0,
  }));
}

/** PUT /items/real-descriptions/reorder  body: { order: number[] } */
async reorderReal(order?: any) {
  if (!Array.isArray(order) || order.length === 0) {
    throw new BadRequestException('Body must be { order: number[] } with at least one id.');
  }
  const ids = order.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  const unique = Array.from(new Set(ids));
  if (unique.length !== ids.length) {
    throw new BadRequestException('Order array contains duplicates or invalid values.');
  }

  const repo = this.ds.getRepository(RealDescription);
  const existing = await repo.find({ select: ['id'], where: { id: In(unique) } });
  const existingIds = new Set(existing.map((e) => e.id));
  const missing = unique.filter((id) => !existingIds.has(id));
  if (missing.length) {
    throw new BadRequestException(`These IDs do not exist: ${missing.join(', ')}`);
  }

  await this.ds.transaction(async (manager) => {
    const cases = unique.map((id, idx) => `WHEN ${id} THEN ${idx + 1}`).join(' ');
    await manager
      .createQueryBuilder()
      .update(RealDescription)
      .set({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sort_index_real_description: () => `CASE id ${cases} END` as any,
      })
      .where('id IN (:...ids)', { ids: unique })
      .execute();
  });
}

/** GET /items/real-descriptions/:realDescId/variants */
async fetchRealDescriptionVariants(opts: {
  realDescId: number;
  page?: number;
  limit?: number;
  q?: string;
}) {
  const page  = Math.max(1, Number(opts.page ?? 1));
  const limit = Math.min(1000, Math.max(1, Number(opts.limit ?? 500)));
  const skip  = (page - 1) * limit;

  const qb = this.itemVariantRepository
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.thickness', 't')
    .innerJoinAndSelect('t.item', 'i')
    .leftJoin('v.realDescription', 'rd')
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
      // we don’t actually need columns from rd here, but you can expose if you want
    ])
    .where('v.realDescriptionId = :id', { id: opts.realDescId });

  if (opts.q) {
    const q = `%${opts.q}%`;
    qb.andWhere(`(i.itemName LIKE :q OR v.origin LIKE :q)`, { q });
  }

  qb
    .orderBy('i.itemName', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('v.length', 'ASC')
    .addOrderBy('v.width', 'ASC')
    .addOrderBy('v.origin', 'ASC')
    .addOrderBy('v.id', 'ASC')
    .skip(skip)
    .take(limit);

  const [rows, total] = await qb.getManyAndCount();

  const data = rows.map((v) => ({
    variantId: v.id,
    itemName: v.thickness.item.itemName,
    thickness: Number(v.thickness.thickness),
    length: Number(v.length ?? 0),
    width: Number(v.width ?? 0),
    sheetsPerBox: Number(v.sheetsPerBox ?? 0),
    origin: v.origin ?? null,
  }));

  return {
    page,
    limit,
    total,
    hasMore: skip + data.length < total,
    data,
  };
}






  // ============== 1) VARIANT SEARCH (for picker) ==============


  // Service.ts



  /** loose: keep user intention, unify spaces, digits & separators */
  private normalizeTextLoose(s?: string) {
    if (s == null) return '';
    const unified = String(s)
      .replace(/\u00A0/g, ' ')         // NBSP → space
      .replace(/[\u2013\u2014]/g, '-') // en/em dash → '-'
      .replace(/[xX×✕✖︎]/g, 'x')       // unify dimension sep to 'x'
      .replace(/\s+/g, ' ');
    const trimmed = unified.trim();
    return this.normalizeDigits(trimmed);
  }

  private buildWhereFromFields(fields?: {
    itemNumber?: string; categoryName?: string; subCategory?: string; colorName?: string; designName?: string;
  }) {
    return {
      itemNumber:  this.normalizeTextLoose(fields?.itemNumber),
      categoryName:this.normalizeTextLoose(fields?.categoryName),
      subCategory: this.normalizeTextLoose(fields?.subCategory),
      colorName:   this.normalizeTextLoose(fields?.colorName),
      designName:  this.normalizeTextLoose(fields?.designName),
    };
  }

  /** Parse query into: thickness (mm), dimensions, and free-text tokens */
  private parseVariantQuery(raw: string) {
    const q = this.normalizeTextLoose(raw);

    const thicknesses: number[] = [];
    const dims: Array<{ L: number; W: number }> = [];
    const text: string[] = [];

    // Dimensions: 225x321 / 225*321 / 225 × 321 (we normalized ×→x)
    const dimRe = /(?<!\d)(\d+(?:\.\d+)?)\s*[x\*]\s*(\d+(?:\.\d+)?)(?!\d)/gi;
    let m: RegExpExecArray | null;
    let consumed: string[] = [];
    while ((m = dimRe.exec(q)) !== null) {
      const L = Number(m[1]);
      const W = Number(m[2]);
      if (Number.isFinite(L) && Number.isFinite(W)) {
        dims.push({ L, W });
        consumed.push(m[0]);
      }
    }

    // Remove the matched dimension chunks so they don't become free tokens
    let rest = q;
    for (const c of consumed) rest = rest.replace(c, ' ');
    const rawTokens = rest.split(/\s+/).filter(Boolean);

    for (const tRaw of rawTokens) {
      const t = tRaw.toLowerCase();

      // thickness like "5.5ملم", "5ملم", "5mm"
      const mmRe = /^(\d+(?:\.\d+)?)(?:\s*(?:ملم|mm))$/i;
      const mmMatch = t.match(mmRe);
      if (mmMatch) {
        const th = Number(mmMatch[1]);
        if (Number.isFinite(th)) {
          thicknesses.push(th);
          continue;
        }
      }

      // everything else = text token (kept original for LIKE)
      text.push(tRaw);
    }

    return { thicknesses, dims, textTokens: text };
  }

  // ──────────────────────────────────────────────
  // 1) VARIANT SEARCH (supports tokens + dimensions)
  // ──────────────────────────────────────────────
  async searchVariantsForRelinker(q: string, page: number, limit: number) {
    const parsed = this.parseVariantQuery(q || '');

    const qb = this.itemVariantRepository
      .createQueryBuilder('v')
      .innerJoin('v.thickness', 'th')
      .innerJoin('th.item', 'item')
      .leftJoin('v.itemNameDescription', 'nd')
      .leftJoin('v.realDescription', 'rd')
      .select([
        'v.id AS variantId',
        'item.id AS itemId',
        'item.itemName AS itemName',
        'item.type AS type',
        'th.id AS thicknessId',
        'th.thickness AS thickness',
        'COALESCE(v.length,0) AS length',
        'COALESCE(v.width,0) AS width',
        'COALESCE(v.sheetsPerBox,0) AS sheetsPerBox',
        'COALESCE(v.origin, \'\') AS origin',
        'nd.id AS nameId','nd.itemNumber AS nItemNumber','nd.categoryName AS nCategoryName','nd.subCategory AS nSubCategory','nd.colorName AS nColorName','nd.designName AS nDesignName',
        'rd.id AS realId','rd.itemNumber AS rItemNumber','rd.categoryName AS rCategoryName','rd.subCategory AS rSubCategory','rd.colorName AS rColorName','rd.designName AS rDesignName',
      ])
      .where('1=1');

    // Thickness: any of provided
    if (parsed.thicknesses.length > 0) {
      qb.andWhere(new Brackets(w => {
        parsed.thicknesses.forEach((th, idx) => {
          w[idx === 0 ? 'where' : 'orWhere'](`th.thickness = :th${idx}`, { [`th${idx}`]: th });
        });
      }));
    }

    // Dimensions: accept swapped
    if (parsed.dims.length > 0) {
      qb.andWhere(new Brackets(w => {
        parsed.dims.forEach((d, idx) => {
          w[idx === 0 ? 'where' : 'orWhere'](new Brackets(sw => {
            sw.where(`(v.length = :L${idx} AND v.width = :W${idx})`, { [`L${idx}`]: d.L, [`W${idx}`]: d.W })
              .orWhere(`(v.length = :W${idx} AND v.width = :L${idx})`, { [`L${idx}`]: d.L, [`W${idx}`]: d.W });
          }));
        });
      }));
    }

    // Text tokens: AND across tokens, OR across fields
    const tokens = parsed.textTokens.map(s => this.normalizeDigits(s)).filter(Boolean);
    if (tokens.length > 0) {
      tokens.forEach((t, i) => {
        const like = `%${t}%`;
        qb.andWhere(new Brackets(w => {
          w.where(`item.itemName LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`nd.itemNumber LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`rd.itemNumber LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`nd.categoryName LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`rd.categoryName LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`nd.subCategory LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`rd.subCategory LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`nd.colorName LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`rd.colorName LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`nd.designName LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`rd.designName LIKE :lk${i}`, { [`lk${i}`]: like })
           .orWhere(`v.origin LIKE :lk${i}`, { [`lk${i}`]: like });
        }));
      });
    }

    // Order & pagination
    qb.orderBy('item.itemName', 'ASC')
      .addOrderBy('th.thickness', 'ASC')
      .addOrderBy('v.length', 'ASC')
      .addOrderBy('v.width', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit);

    // Exact total (respect filters): clone and count distinct v.id
    const countQb = qb.clone()
      .select('COUNT(DISTINCT v.id)', 'cnt')
      .offset(undefined)
      .limit(undefined)
      .orderBy(undefined);
    const countRow = await countQb.getRawOne<{ cnt: string }>();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await qb.getRawMany();

    const data = rows.map(r => ({
      variantId: Number(r.variantId),
      itemId: Number(r.itemId),
      itemName: r.itemName,
      type: r.type as 'box'|'sheet'|'sqm',
      thicknessId: Number(r.thicknessId),
      thickness: Number(r.thickness),
      length: Number(r.length),
      width: Number(r.width),
      sheetsPerBox: Number(r.sheetsPerBox),
      origin: r.origin,
      itemNameDescription: r.nameId ? {
        id: Number(r.nameId),
        itemNumber: r.nItemNumber, categoryName: r.nCategoryName, subCategory: r.nSubCategory, colorName: r.nColorName, designName: r.nDesignName,
      } : null,
      realDescription: r.realId ? {
        id: Number(r.realId),
        itemNumber: r.rItemNumber, categoryName: r.rCategoryName, subCategory: r.rSubCategory, colorName: r.rColorName, designName: r.rDesignName,
      } : null,
    }));

    return { data, page, limit, total };
  }

  // ──────────────────────────────────────────────
  // 2) DESCRIPTION SEARCH (autocomplete)
  // ──────────────────────────────────────────────
  async searchDescriptions(
    mode: 'real' | 'name',
    q: string,
    page: number,
    limit: number,
  ) {
    const repo = mode === 'real' ? this.realDescriptionRepository : this.itemNameDescriptionRepository;
    const qb = repo.createQueryBuilder('d').where('1=1');

    const normalized = this.normalizeTextLoose(q || '');
    if (normalized) {
      const tokens = normalized.split(/\s+/).filter(Boolean);
      tokens.forEach((t, i) => {
        const like = `%${t}%`;
        qb.andWhere(new Brackets(w => {
          w.where(`d.itemNumber LIKE :l${i}`, { [`l${i}`]: like })
           .orWhere(`d.categoryName LIKE :l${i}`, { [`l${i}`]: like })
           .orWhere(`d.subCategory LIKE :l${i}`, { [`l${i}`]: like })
           .orWhere(`d.colorName LIKE :l${i}`, { [`l${i}`]: like })
           .orWhere(`d.designName LIKE :l${i}`, { [`l${i}`]: like });
        }));
      });
    }

    qb.orderBy('d.itemNumber', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { data: rows, page, limit, total };
  }

  // ──────────────────────────────────────────────
  // 3) RELINK LOGIC (side-specific creation)
  // ──────────────────────────────────────────────
  /** create/link ONLY ItemNameDescription */
  private async resolveOrCreateName(fields?: {
    itemNumber?: string; categoryName?: string; subCategory?: string; colorName?: string; designName?: string;
  }) {
    const where = this.buildWhereFromFields(fields);
    let nameDesc = await this.itemNameDescriptionRepository.findOne({ where });
    if (!nameDesc) {
      nameDesc = await this.itemNameDescriptionRepository.save(
        this.itemNameDescriptionRepository.create(where),
      );
    }
    return nameDesc;
  }

  /** create/link ONLY RealDescription */
  private async resolveOrCreateReal(fields?: {
    itemNumber?: string; categoryName?: string; subCategory?: string; colorName?: string; designName?: string;
  }) {
    const where = this.buildWhereFromFields(fields);
    let realDesc = await this.realDescriptionRepository.findOne({ where });
    if (!realDesc) {
      realDesc = await this.realDescriptionRepository.save(
        this.realDescriptionRepository.create(where),
      );
    }
    return realDesc;
  }

  /** optional: keep pair helper for the BOTH case */
  private async resolveOrCreatePair(fields?: {
    itemNumber?: string; categoryName?: string; subCategory?: string; colorName?: string; designName?: string;
  }) {
    const where = this.buildWhereFromFields(fields);
    // Name
    let nameDesc = await this.itemNameDescriptionRepository.findOne({ where });
    if (!nameDesc) {
      nameDesc = await this.itemNameDescriptionRepository.save(
        this.itemNameDescriptionRepository.create(where),
      );
    }
    // Real
    let realDesc = await this.realDescriptionRepository.findOne({ where });
    if (!realDesc) {
      realDesc = await this.realDescriptionRepository.save(
        this.realDescriptionRepository.create(where),
      );
    }
    return { nameDesc, realDesc };
  }

 // ItemsService.ts (only the method below needs replacing)

async relinkVariantDescription(
  variantId: number,
  dto: {
    mode: 'real' | 'name';
    description?: { id?: number } | null; // ← allow null to unlink
    fields?: {
      itemNumber?: string; categoryName?: string; subCategory?: string; colorName?: string; designName?: string;
    } | null;
    alsoSetOtherSide?: boolean;
  }
) {
  const variant = await this.itemVariantRepository.findOne({
    where: { id: variantId },
    relations: ['thickness', 'thickness.item', 'itemNameDescription', 'realDescription'],
  });
  if (!variant) throw new NotFoundException(`Variant ${variantId} not found`);

  const setBoth = !!dto.alsoSetOtherSide;

  // ──────────────────────────────────────────────
  // A) UNLINK (set FK to null) when description === null and no fields
  // ──────────────────────────────────────────────
  if (dto.hasOwnProperty('description') && dto.description === null && !dto.fields) {
    if (dto.mode === 'name') {
      variant.itemNameDescription = null;
      if (setBoth) variant.realDescription = null;
    } else {
      variant.realDescription = null;
      if (setBoth) variant.itemNameDescription = null;
    }

    await this.itemVariantRepository.save(variant);
    return {
      variantId: variant.id,
      itemId: variant.thickness?.item?.id ?? null,
      thicknessId: variant.thickness?.id ?? null,
      itemNameDescription: variant.itemNameDescription ?? null,
      realDescription: variant.realDescription ?? null,
    };
  }

  // ──────────────────────────────────────────────
  // B) LINK to existing by id
  // ──────────────────────────────────────────────
  if (dto?.description?.id) {
    if (dto.mode === 'name') {
      const targetName = await this.itemNameDescriptionRepository.findOne({ where: { id: dto.description.id } });
      if (!targetName) throw new NotFoundException(`ItemNameDescription id=${dto.description.id} not found`);
      variant.itemNameDescription = targetName;

      if (setBoth) {
        let targetReal = await this.realDescriptionRepository.findOne({
          where: {
            itemNumber: targetName.itemNumber,
            categoryName: targetName.categoryName,
            subCategory: targetName.subCategory,
            colorName: targetName.colorName,
            designName: targetName.designName,
          },
        });
        if (!targetReal) {
          targetReal = await this.realDescriptionRepository.save(
            this.realDescriptionRepository.create({
              itemNumber: targetName.itemNumber,
              categoryName: targetName.categoryName,
              subCategory: targetName.subCategory,
              colorName: targetName.colorName,
              designName: targetName.designName,
            }),
          );
        }
        variant.realDescription = targetReal;
      }
    } else {
      const targetReal = await this.realDescriptionRepository.findOne({ where: { id: dto.description.id } });
      if (!targetReal) throw new NotFoundException(`RealDescription id=${dto.description.id} not found`);
      variant.realDescription = targetReal;

      if (setBoth) {
        let targetName = await this.itemNameDescriptionRepository.findOne({
          where: {
            itemNumber: targetReal.itemNumber,
            categoryName: targetReal.categoryName,
            subCategory: targetReal.subCategory,
            colorName: targetReal.colorName,
            designName: targetReal.designName,
          },
        });
        if (!targetName) {
          targetName = await this.itemNameDescriptionRepository.save(
            this.itemNameDescriptionRepository.create({
              itemNumber: targetReal.itemNumber,
              categoryName: targetReal.categoryName,
              subCategory: targetReal.subCategory,
              colorName: targetReal.colorName,
              designName: targetReal.designName,
            }),
          );
        }
        variant.itemNameDescription = targetName;
      }
    }

    await this.itemVariantRepository.save(variant);
    return {
      variantId: variant.id,
      itemId: variant.thickness?.item?.id ?? null,
      thicknessId: variant.thickness?.id ?? null,
      itemNameDescription: variant.itemNameDescription ?? null,
      realDescription: variant.realDescription ?? null,
    };
  }

  // ──────────────────────────────────────────────
  // C) Resolve/Create from fields (side-specific)
  // ──────────────────────────────────────────────
  if (dto.fields) {
    if (dto.mode === 'name') {
      const name = await this.resolveOrCreateName(dto.fields);
      variant.itemNameDescription = name;
      if (setBoth) {
        const real = await this.resolveOrCreateReal(dto.fields);
        variant.realDescription = real;
      }
    } else {
      const real = await this.resolveOrCreateReal(dto.fields);
      variant.realDescription = real;
      if (setBoth) {
        const name = await this.resolveOrCreateName(dto.fields);
        variant.itemNameDescription = name;
      }
    }

    await this.itemVariantRepository.save(variant);
    return {
      variantId: variant.id,
      itemId: variant.thickness?.item?.id ?? null,
      thicknessId: variant.thickness?.id ?? null,
      itemNameDescription: variant.itemNameDescription ?? null,
      realDescription: variant.realDescription ?? null,
    };
  }

  throw new BadRequestException(
    'Provide either "description.id", or "fields", or set "description": null (to unlink).'
  );
}

  private normalizeTextStrict(s?: string) {
    if (s == null) return '';
    const unified = String(s)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ');
    const trimmed = unified.trim();
    return this.normalizeDigits(trimmed);
  }



private async editDescriptionRowNoDto(
    repoName: 'itemNameDescriptionRepository' | 'realDescriptionRepository',
    linkField: 'itemNameDescription' | 'realDescription',
    id: number,
    body: any,
  ) {
    if (!id || isNaN(+id)) throw new BadRequestException('Invalid id');
    if (!body || typeof body !== 'object') throw new BadRequestException('Request body is required');

    // 1) Load row
    const repo = (this as any)[repoName] as any;
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`${repoName} id=${id} not found`);

    // 2) Compute next values (partial update, normalize only provided)
    const next = {
      itemNumber:   body.itemNumber   !== undefined ? this.normalizeTextStrict(body.itemNumber)   : row.itemNumber,
      categoryName: body.categoryName !== undefined ? this.normalizeTextStrict(body.categoryName) : row.categoryName,
      subCategory:  body.subCategory  !== undefined ? this.normalizeTextStrict(body.subCategory)  : row.subCategory,
      colorName:    body.colorName    !== undefined ? this.normalizeTextStrict(body.colorName)    : row.colorName,
      designName:   body.designName   !== undefined ? this.normalizeTextStrict(body.designName)   : row.designName,
    };

    // No-op
    if (
      next.itemNumber   === row.itemNumber &&
      next.categoryName === row.categoryName &&
      next.subCategory  === row.subCategory &&
      next.colorName    === row.colorName &&
      next.designName   === row.designName
    ) {
      return row;
    }

    // 3) Duplicate check
    const existing = await repo.findOne({
      where: {
        itemNumber: next.itemNumber,
        categoryName: next.categoryName,
        subCategory: next.subCategory,
        colorName: next.colorName,
        designName: next.designName,
      },
    });

    const onDuplicate: 'error' | 'merge' =
      body?.onDuplicate === 'merge' ? 'merge' : 'error';

    if (existing && existing.id !== row.id) {
      if (onDuplicate === 'error') {
        throw new ConflictException('A description with these fields already exists.');
      }

      // MERGE: relink variants from row -> existing, then delete row
      await this.dataSource.transaction(async (manager) => {
        // If you have the ItemVariant entity, prefer the typed builder:
        // await manager
        //   .createQueryBuilder(ItemVariant, 'v')
        //   .update(ItemVariant)
        //   .set({ [linkField]: existing.id })
        //   .where(`${linkField}Id = :sid`, { sid: row.id })
        //   .execute();

        // Fallback: use table & column names directly if needed
        await manager
          .createQueryBuilder()
          .update('item_variant') // <- change to your actual table name if different
          .set({ [`${linkField}`]: existing.id })
          .where(`${linkField}Id = :sid`, { sid: row.id })
          .execute();

        await manager.getRepository(repo.metadata.target).delete(row.id);
      });

      return existing;
    }

    // 4) Update in place
    row.itemNumber   = next.itemNumber;
    row.categoryName = next.categoryName;
    row.subCategory  = next.subCategory;
    row.colorName    = next.colorName;
    row.designName   = next.designName;

    return await repo.save(row);
  }

  // Public methods (NO DTO)
  async updateItemNameDescriptionRaw(id: number, body: any) {
    return this.editDescriptionRowNoDto(
      'itemNameDescriptionRepository',
      'itemNameDescription',
      id,
      body,
    );
  }

  async updateRealDescriptionRaw(id: number, body: any) {
    return this.editDescriptionRowNoDto(
      'realDescriptionRepository',
      'realDescription',
      id,
      body,
    );
  }





async getItemsStockTotals(opts?: any) {
  const page = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(500, Math.max(1, Number(opts?.limit ?? 50)));
  const start = (page - 1) * limit;

  const fix =
    String(opts?.fix ?? '').toLowerCase() === '1' ||
    String(opts?.fix ?? '').toLowerCase() === 'true';

  const includeVariants =
    String(opts?.includeVariants ?? '1').toLowerCase() !== '0' &&
    String(opts?.includeVariants ?? '1').toLowerCase() !== 'false';

  const includeBatches =
    String(opts?.includeBatches ?? '1').toLowerCase() !== '0' &&
    String(opts?.includeBatches ?? '1').toLowerCase() !== 'false';

  const tol = Number.isFinite(Number(opts?.tol)) ? Math.max(0, Number(opts?.tol)) : 0.01;

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const r2 = (n: any) => Number(toNum(n).toFixed(2));
  const calcBal = (st: any, inn: any, out: any) => r2(toNum(st) + toNum(inn) - toNum(out));
  const isDiff = (a: any, b: any) => Math.abs(toNum(a) - toNum(b)) > tol;

  // ✅ counts
  const totalItems = await this.itemRepository.count();
  const totalVariants = await this.dataSource.getRepository(ItemVariant).count();
  const totalPages = Math.max(1, Math.ceil(totalVariants / limit));

  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  if (fix) await qr.startTransaction();

  try {
    // ============================================================
    // ✅ STEP 1: Get ONLY variant IDs for this page (sorted properly)
    // ============================================================
    const idRows = await qr.manager
      .getRepository(ItemVariant)
      .createQueryBuilder('v')
      .leftJoin('v.thickness', 'th')
      .leftJoin('th.item', 'item')
      .leftJoin(RealDescription, 'rd', 'rd.id = v.realDescriptionId')
      .select(['v.id AS id'])
      .orderBy('item.sortIndex', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .addOrderBy('th.sort_index', 'ASC')
      .addOrderBy('th.id', 'ASC')
      // ✅ sort by realDescription.sortIndex (nulls last)
      .addOrderBy('COALESCE(rd.sort_index_real_description, 999999)', 'ASC')
      .addOrderBy('rd.id', 'ASC')
      .addOrderBy('v.id', 'ASC')
      .skip(start)
      .take(limit)
      .getRawMany();

    const variantIds = idRows.map((r: any) => Number(r?.id)).filter((x) => Number.isFinite(x) && x > 0);

    // No variants in this page
    if (!variantIds.length) {
      if (fix) await qr.commitTransaction();
      return {
        page,
        limit,
        totalItems,
        totalVariants,
        totalPages,
        hasMore: page < totalPages,
        fixApplied: fix,
        tolerance: tol,
        data: [],
      };
    }

    // ============================================================
    // ✅ STEP 2: Fetch variants + item/thickness (+ batches) for IDs
    // ============================================================
    const vqb = qr.manager
      .getRepository(ItemVariant)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.thickness', 'th')
      .leftJoinAndSelect('th.item', 'item')
      .leftJoin(RealDescription, 'rd', 'rd.id = v.realDescriptionId')
      .where('v.id IN (:...ids)', { ids: variantIds });

    if (includeBatches) vqb.leftJoinAndSelect('v.batches', 'b');
    else vqb.leftJoin('v.batches', 'b');

    // keep the SAME ordering as step 1
    vqb.orderBy('item.sortIndex', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .addOrderBy('th.sort_index', 'ASC')
      .addOrderBy('th.id', 'ASC')
      .addOrderBy('COALESCE(rd.sort_index_real_description, 999999)', 'ASC')
      .addOrderBy('rd.id', 'ASC')
      .addOrderBy('v.id', 'ASC')
      .addOrderBy('b.id', 'ASC');

    const variants = await vqb.getMany();

    // ============================================================
    // Build response in SAME SHAPE your frontend expects:
    // data: [{ itemId, itemName, type, ..., variants: [...] }]
    // ============================================================
    const itemMap = new Map<number, any>();

    for (const v of variants) {
      const th: any = (v as any).thickness;
      const item: any = th?.item;

      const itemId = Number(item?.id);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;

      if (!itemMap.has(itemId)) {
        itemMap.set(itemId, {
          itemId,
          itemName: item?.itemName ?? null,
          type: item?.type ?? null,
          stockMode: item?.stockMode ?? null,
          sortIndex: item?.sortIndex ?? null,
          totals: {
            start: 0, in: 0, out: 0, balance: 0,
            startOFR: 0, inOFR: 0, outOFR: 0, balanceOFR: 0,
          },
          variants: [],
        });
      }

      // ---------- compute stored vs computed ----------
      const storedV = {
        totalStart: r2((v as any).totalStart),
        totalIn: r2((v as any).totalIn),
        totalOut: r2((v as any).totalOut),
        totalBalance: r2((v as any).totalBalance),

        totalStartOFR: r2((v as any).totalStartOFR),
        totalInOFR: r2((v as any).totalInOFR),
        totalOutOFR: r2((v as any).totalOutOFR),
        totalBalanceOFR: r2((v as any).totalBalanceOFR),
      };

      let computedV = { ...storedV };
      const batchesOut: any[] = [];

      if (includeBatches) {
        let vStart = 0, vIn = 0, vOut = 0, vBal = 0;
        let vStartO = 0, vInO = 0, vOutO = 0, vBalO = 0;

        for (const b of ((v as any).batches || [])) {
          const expBal = calcBal(b.start, b.in, b.out);
          const expBalO = calcBal(b.startOFR, b.inOFR, b.outOFR);

          const wrongBal = isDiff(b.balance, expBal);
          const wrongBalO = isDiff(b.balanceOFR, expBalO);

          if (fix && (wrongBal || wrongBalO)) {
            if (wrongBal) (b as any).balance = expBal;
            if (wrongBalO) (b as any).balanceOFR = expBalO;
          }

          const effBal = fix && wrongBal ? expBal : b.balance;
          const effBalO = fix && wrongBalO ? expBalO : b.balanceOFR;

          vStart += toNum(b.start);
          vIn += toNum(b.in);
          vOut += toNum(b.out);
          vBal += toNum(effBal);

          vStartO += toNum(b.startOFR);
          vInO += toNum(b.inOFR);
          vOutO += toNum(b.outOFR);
          vBalO += toNum(effBalO);

          batchesOut.push({
            batchId: b.id,
            condition: b.condition ?? null,
            dateReceived: b.dateReceived ?? null,

            start: r2(b.start),
            in: r2(b.in),
            out: r2(b.out),
            balance: r2(effBal),
            expectedBalance: expBal,
            wrongBalance: wrongBal,

            startOFR: r2(b.startOFR),
            inOFR: r2(b.inOFR),
            outOFR: r2(b.outOFR),
            balanceOFR: r2(effBalO),
            expectedBalanceOFR: expBalO,
            wrongBalanceOFR: wrongBalO,
          });
        }

        computedV = {
          totalStart: r2(vStart),
          totalIn: r2(vIn),
          totalOut: r2(vOut),
          totalBalance: r2(vBal),

          totalStartOFR: r2(vStartO),
          totalInOFR: r2(vInO),
          totalOutOFR: r2(vOutO),
          totalBalanceOFR: r2(vBalO),
        };

        const totalsMismatch =
          isDiff(storedV.totalStart, computedV.totalStart) ||
          isDiff(storedV.totalIn, computedV.totalIn) ||
          isDiff(storedV.totalOut, computedV.totalOut) ||
          isDiff(storedV.totalBalance, computedV.totalBalance) ||
          isDiff(storedV.totalStartOFR, computedV.totalStartOFR) ||
          isDiff(storedV.totalInOFR, computedV.totalInOFR) ||
          isDiff(storedV.totalOutOFR, computedV.totalOutOFR) ||
          isDiff(storedV.totalBalanceOFR, computedV.totalBalanceOFR);

        if (fix && totalsMismatch) {
          (v as any).totalStart = computedV.totalStart;
          (v as any).totalIn = computedV.totalIn;
          (v as any).totalOut = computedV.totalOut;
          (v as any).totalBalance = computedV.totalBalance;

          (v as any).totalStartOFR = computedV.totalStartOFR;
          (v as any).totalInOFR = computedV.totalInOFR;
          (v as any).totalOutOFR = computedV.totalOutOFR;
          (v as any).totalBalanceOFR = computedV.totalBalanceOFR;
        }

        if (fix && ((v as any).batches?.length || 0) > 0) {
          await qr.manager.getRepository(ItemBatch).save((v as any).batches as any[]);
        }
        if (fix) {
          await qr.manager.getRepository(ItemVariant).save(v as any);
        }
      }

      // update item totals (for this page only)
      const acc = itemMap.get(itemId);
      acc.totals.start += toNum(computedV.totalStart);
      acc.totals.in += toNum(computedV.totalIn);
      acc.totals.out += toNum(computedV.totalOut);
      acc.totals.balance += toNum(computedV.totalBalance);

      acc.totals.startOFR += toNum(computedV.totalStartOFR);
      acc.totals.inOFR += toNum(computedV.totalInOFR);
      acc.totals.outOFR += toNum(computedV.totalOutOFR);
      acc.totals.balanceOFR += toNum(computedV.totalBalanceOFR);

      if (includeVariants) {
        acc.variants.push({
          variantId: (v as any).id,
          thicknessId: th?.id ?? null,
          thickness: r2(th?.thickness),

          length: r2((v as any).length),
          width: r2((v as any).width),
          origin: (v as any).origin ?? null,
          sheetsPerBox: Number((v as any).sheetsPerBox || 0),
          realDescriptionId: (v as any).realDescriptionId ?? null,

          stored: storedV,
          computed: computedV,
          mismatch: includeBatches
            ? (
                isDiff(storedV.totalStart, computedV.totalStart) ||
                isDiff(storedV.totalIn, computedV.totalIn) ||
                isDiff(storedV.totalOut, computedV.totalOut) ||
                isDiff(storedV.totalBalance, computedV.totalBalance) ||
                isDiff(storedV.totalStartOFR, computedV.totalStartOFR) ||
                isDiff(storedV.totalInOFR, computedV.totalInOFR) ||
                isDiff(storedV.totalOutOFR, computedV.totalOutOFR) ||
                isDiff(storedV.totalBalanceOFR, computedV.totalBalanceOFR)
              )
            : false,

          batches: includeBatches ? batchesOut : undefined,
        });
      }
    }

    // finalize totals rounding
    const data = Array.from(itemMap.values()).map((it) => ({
      ...it,
      totals: {
        start: r2(it.totals.start),
        in: r2(it.totals.in),
        out: r2(it.totals.out),
        balance: r2(it.totals.balance),
        startOFR: r2(it.totals.startOFR),
        inOFR: r2(it.totals.inOFR),
        outOFR: r2(it.totals.outOFR),
        balanceOFR: r2(it.totals.balanceOFR),
      },
    }));

    if (fix) await qr.commitTransaction();

    return {
      page,
      limit,
      totalItems,
      totalVariants,           // ✅ NOW pagination is by variants
      totalPages,
      hasMore: page < totalPages,
      fixApplied: fix,
      tolerance: tol,
      data,
    };
  } catch (e) {
    if (fix) {
      try { await qr.rollbackTransaction(); } catch {}
    }
    throw e;
  } finally {
    try { await qr.release(); } catch {}
  }
}


  /* ---------------- helpers ---------------- */
  private toANum(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  private r2(v: any) {
    return Number(this.toANum(v).toFixed(2));
  }
  private calcBal(st: any, inn: any, out: any) {
    return this.r2(this.toANum(st) + this.toANum(inn) - this.toANum(out));
  }
  private isDiff(a: any, b: any, tol: number) {
    return Math.abs(this.toANum(a) - this.toANum(b)) > tol;
  }

  /* ============================================================
     ✅ 1) GET variants audit (PAGINATE BY VARIANTS, not items)
     ============================================================ */

  // ----------------------------
  // PUT /items/v2/stock-totals/variants/:id/totals
  // Body: { totalStart, totalIn, totalOut, totalStartOFR, totalInOFR, totalOutOFR }
  // Server auto-calculates balances.
  // ----------------------------



    async getVariantStockAudit(q: any) {
    const page = Math.max(1, Number(q?.page ?? 1));
    const limit = Math.min(2000, Math.max(1, Number(q?.limit ?? 200))); // allow big lists
    const skip = (page - 1) * limit;

    const search = String(q?.search ?? '').trim();
    const type = String(q?.type ?? 'all').toLowerCase(); // all|box|sheet|sqm|unit
    const includeBatches = String(q?.includeBatches ?? '1') === '1' || String(q?.includeBatches ?? '').toLowerCase() === 'true';
    const onlyIssues = String(q?.onlyIssues ?? '0') === '1' || String(q?.onlyIssues ?? '').toLowerCase() === 'true';
    const fix = String(q?.fix ?? '0') === '1' || String(q?.fix ?? '').toLowerCase() === 'true';
    const tol = Number.isFinite(Number(q?.tol)) ? Math.max(0, Number(q?.tol)) : 0.01;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    if (fix) await qr.startTransaction();

    try {
      // 1) Page VARIANT IDS (no batches join here!)
      const base = qr.manager
        .getRepository(ItemVariant)
        .createQueryBuilder('v')
        .leftJoin('v.thickness', 'th')
        .leftJoin('th.item', 'item');

      if (search) {
        base.andWhere('LOWER(item.itemName) LIKE :s', { s: `%${search.toLowerCase()}%` });
      }
      if (type !== 'all') {
        base.andWhere('LOWER(item.type) = :t', { t: type });
      }

      const totalVariants = await base.clone().getCount();

      const idRows = await base
        .select('v.id', 'id')
        .orderBy('item.sortIndex', 'ASC')
        .addOrderBy('item.id', 'ASC')
        .addOrderBy('th.sort_index', 'ASC')
        .addOrderBy('th.id', 'ASC')
        .addOrderBy('v.id', 'ASC')
        .skip(skip)
        .take(limit)
        .getRawMany();

      const variantIds = idRows.map((r) => Number(r.id)).filter((x) => x > 0);
      if (variantIds.length === 0) {
        if (fix) await qr.commitTransaction();
        return {
          page,
          limit,
          totalVariants,
          totalPages: Math.max(1, Math.ceil(totalVariants / limit)),
          hasMore: page < Math.max(1, Math.ceil(totalVariants / limit)),
          fixApplied: fix,
          tolerance: tol,
          data: [],
        };
      }

      // 2) Load VARIANTS + ITEM + THICKNESS (+ batches)
      const qb2 = qr.manager
        .getRepository(ItemVariant)
        .createQueryBuilder('v')
        .leftJoinAndSelect('v.thickness', 'th')
        .leftJoinAndSelect('th.item', 'item')
        .where('v.id IN (:...ids)', { ids: variantIds })
        .orderBy('item.sortIndex', 'ASC')
        .addOrderBy('item.id', 'ASC')
        .addOrderBy('th.sort_index', 'ASC')
        .addOrderBy('th.id', 'ASC')
        .addOrderBy('v.id', 'ASC');

      if (includeBatches) {
        qb2.leftJoinAndSelect('v.batches', 'b').addOrderBy('b.id', 'ASC');
      }

      const variants = await qb2.getMany();

      // 3) Compute / fix
      const out: any[] = [];

      for (const v of variants) {
        const item = (v as any).thickness?.item;
        if (!item) continue;

        // compute from batches
        let sumSt = 0, sumIn = 0, sumOut = 0;
        let sumStO = 0, sumInO = 0, sumOutO = 0;

        const batches = Array.isArray((v as any).batches) ? (v as any).batches : [];
        const batchRows: any[] = [];

        for (const b of batches) {
          const expBal = this.calcBal((b as any).start, (b as any).in, (b as any).out);
          const expBalO = this.calcBal((b as any).startOFR, (b as any).inOFR, (b as any).outOFR);

          const wrongBal = this.isDiff((b as any).balance, expBal, tol);
          const wrongBalO = this.isDiff((b as any).balanceOFR, expBalO, tol);

          if (fix) {
            if (wrongBal) (b as any).balance = expBal;
            if (wrongBalO) (b as any).balanceOFR = expBalO;
          }

          sumSt += this.toNum((b as any).start);
          sumIn += this.toNum((b as any).in);
          sumOut += this.toNum((b as any).out);

          sumStO += this.toNum((b as any).startOFR);
          sumInO += this.toNum((b as any).inOFR);
          sumOutO += this.toNum((b as any).outOFR);

          batchRows.push({
            batchId: (b as any).id,
            condition: (b as any).condition ?? null,
            dateReceived: (b as any).dateReceived ?? null,
            start: this.r2((b as any).start),
            in: this.r2((b as any).in),
            out: this.r2((b as any).out),
            balance: this.r2((b as any).balance),
            startOFR: this.r2((b as any).startOFR),
            inOFR: this.r2((b as any).inOFR),
            outOFR: this.r2((b as any).outOFR),
            balanceOFR: this.r2((b as any).balanceOFR),
            computed: {
              expectedBalance: expBal,
              expectedBalanceOFR: expBalO,
              wrongBalance: wrongBal,
              wrongBalanceOFR: wrongBalO,
            },
          });
        }

        const computed = {
          totalStart: this.r2(sumSt),
          totalIn: this.r2(sumIn),
          totalOut: this.r2(sumOut),
          totalBalance: this.r2(sumSt + sumIn - sumOut),

          totalStartOFR: this.r2(sumStO),
          totalInOFR: this.r2(sumInO),
          totalOutOFR: this.r2(sumOutO),
          totalBalanceOFR: this.r2(sumStO + sumInO - sumOutO),
        };

        const stored = {
          totalStart: this.r2((v as any).totalStart),
          totalIn: this.r2((v as any).totalIn),
          totalOut: this.r2((v as any).totalOut),
          totalBalance: this.r2((v as any).totalBalance),

          totalStartOFR: this.r2((v as any).totalStartOFR),
          totalInOFR: this.r2((v as any).totalInOFR),
          totalOutOFR: this.r2((v as any).totalOutOFR),
          totalBalanceOFR: this.r2((v as any).totalBalanceOFR),
        };

        const mismatch =
          this.isDiff(stored.totalStart, computed.totalStart, tol) ||
          this.isDiff(stored.totalIn, computed.totalIn, tol) ||
          this.isDiff(stored.totalOut, computed.totalOut, tol) ||
          this.isDiff(stored.totalBalance, computed.totalBalance, tol) ||
          this.isDiff(stored.totalStartOFR, computed.totalStartOFR, tol) ||
          this.isDiff(stored.totalInOFR, computed.totalInOFR, tol) ||
          this.isDiff(stored.totalOutOFR, computed.totalOutOFR, tol) ||
          this.isDiff(stored.totalBalanceOFR, computed.totalBalanceOFR, tol);

        // If fix=1, set variant totals to computed
        if (fix && mismatch) {
          (v as any).totalStart = computed.totalStart;
          (v as any).totalIn = computed.totalIn;
          (v as any).totalOut = computed.totalOut;
          (v as any).totalBalance = computed.totalBalance;

          (v as any).totalStartOFR = computed.totalStartOFR;
          (v as any).totalInOFR = computed.totalInOFR;
          (v as any).totalOutOFR = computed.totalOutOFR;
          (v as any).totalBalanceOFR = computed.totalBalanceOFR;
        }

        // Persist any fixes
        if (fix && includeBatches && batches.length) {
          await qr.manager.getRepository(ItemBatch).save(batches);
        }
        if (fix && mismatch) {
          await qr.manager.getRepository(ItemVariant).save(v as any);
        }

        const hasBatchIssues = batchRows.some((bb) => bb.computed.wrongBalance || bb.computed.wrongBalanceOFR);
        const hasIssues = mismatch || hasBatchIssues;

        if (!onlyIssues || hasIssues) {
          out.push({
            // item info (what your UI needs)
            itemId: item.id,
            itemName: item.itemName,
            type: item.type,
            stockMode: item.stockMode,
            sortIndex: item.sortIndex ?? null,

            // variant fields (what your UI asked for)
            variantId: (v as any).id,
            thicknessId: (v as any).thickness?.id ?? null,
            thickness: this.r2((v as any).thickness?.thickness),
            length: this.r2((v as any).length),
            width: this.r2((v as any).width),
            origin: (v as any).origin ?? null,
            sheetsPerBox: Number((v as any).sheetsPerBox || 0),

            stored,
            computed,
            mismatch,

            batches: includeBatches ? batchRows : undefined,
          });
        }
      }

      if (fix) await qr.commitTransaction();

      const totalPages = Math.max(1, Math.ceil(totalVariants / limit));
      return {
        page,
        limit,
        totalVariants,
        totalPages,
        hasMore: page < totalPages,
        fixApplied: fix,
        tolerance: tol,
        data: out,
      };
    } catch (e) {
      if (fix) {
        try { await qr.rollbackTransaction(); } catch {}
      }
      throw e;
    } finally {
      try { await qr.release(); } catch {}
    }
  }

  /* ============================================================
     ✅ 2) PUT variant totals (edit totals, server recalculates balance)
     ============================================================ */
  async updateVariantTotals(variantId: number, body: any) {
    if (!Number.isInteger(variantId) || variantId <= 0) {
      throw new BadRequestException('invalid variantId');
    }

    const repo = this.dataSource.getRepository(ItemVariant);
    const v = await repo.findOne({ where: { id: variantId } as any });
    if (!v) throw new NotFoundException(`ItemVariant #${variantId} not found`);

    // Update only start/in/out fields (base + ofr)
    const st = this.r2(body?.totalStart);
    const inn = this.r2(body?.totalIn);
    const outt = this.r2(body?.totalOut);

    const stO = this.r2(body?.totalStartOFR);
    const inO = this.r2(body?.totalInOFR);
    const outO = this.r2(body?.totalOutOFR);

    (v as any).totalStart = st;
    (v as any).totalIn = inn;
    (v as any).totalOut = outt;
    (v as any).totalBalance = this.r2(st + inn - outt);

    (v as any).totalStartOFR = stO;
    (v as any).totalInOFR = inO;
    (v as any).totalOutOFR = outO;
    (v as any).totalBalanceOFR = this.r2(stO + inO - outO);

    await repo.save(v as any);

    return {
      ok: true,
      variantId,
      stored: {
        totalStart: this.r2((v as any).totalStart),
        totalIn: this.r2((v as any).totalIn),
        totalOut: this.r2((v as any).totalOut),
        totalBalance: this.r2((v as any).totalBalance),
        totalStartOFR: this.r2((v as any).totalStartOFR),
        totalInOFR: this.r2((v as any).totalInOFR),
        totalOutOFR: this.r2((v as any).totalOutOFR),
        totalBalanceOFR: this.r2((v as any).totalBalanceOFR),
      },
    };
  }

  /* ============================================================
     ✅ 3) PUT batch totals (edit batch, server recalculates balance,
         then rebuild the parent variant totals from ALL batches)
     ============================================================ */
  async updateBatchTotals(batchId: number, body: any) {
    if (!Number.isInteger(batchId) || batchId <= 0) {
      throw new BadRequestException('invalid batchId');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const batchRepo = qr.manager.getRepository(ItemBatch);
      const varRepo = qr.manager.getRepository(ItemVariant);

      const b = await batchRepo.findOne({
        where: { id: batchId } as any,
        relations: ['itemVariant'] as any,
      });

      if (!b) throw new NotFoundException(`ItemBatch #${batchId} not found`);
      const variantId = (b as any)?.itemVariant?.id;
      if (!variantId) throw new BadRequestException('Batch missing itemVariant relation');

      // update batch fields
      (b as any).start = this.r2(body?.start);
      (b as any).in = this.r2(body?.in);
      (b as any).out = this.r2(body?.out);

      (b as any).startOFR = this.r2(body?.startOFR);
      (b as any).inOFR = this.r2(body?.inOFR);
      (b as any).outOFR = this.r2(body?.outOFR);

      // recalc batch balances always
      (b as any).balance = this.calcBal((b as any).start, (b as any).in, (b as any).out);
      (b as any).balanceOFR = this.calcBal((b as any).startOFR, (b as any).inOFR, (b as any).outOFR);

      await batchRepo.save(b as any);

      // rebuild variant totals from all batches for this variant
      const allBatches = await batchRepo.find({ where: { itemVariant: { id: variantId } } as any });
      let sumSt = 0, sumIn = 0, sumOut = 0;
      let sumStO = 0, sumInO = 0, sumOutO = 0;

      for (const bb of allBatches) {
        sumSt += this.toNum((bb as any).start);
        sumIn += this.toNum((bb as any).in);
        sumOut += this.toNum((bb as any).out);

        sumStO += this.toNum((bb as any).startOFR);
        sumInO += this.toNum((bb as any).inOFR);
        sumOutO += this.toNum((bb as any).outOFR);
      }

      const v = await varRepo.findOne({ where: { id: variantId } as any });
      if (!v) throw new NotFoundException(`ItemVariant #${variantId} not found`);

      (v as any).totalStart = this.r2(sumSt);
      (v as any).totalIn = this.r2(sumIn);
      (v as any).totalOut = this.r2(sumOut);
      (v as any).totalBalance = this.r2(sumSt + sumIn - sumOut);

      (v as any).totalStartOFR = this.r2(sumStO);
      (v as any).totalInOFR = this.r2(sumInO);
      (v as any).totalOutOFR = this.r2(sumOutO);
      (v as any).totalBalanceOFR = this.r2(sumStO + sumInO - sumOutO);

      await varRepo.save(v as any);

      await qr.commitTransaction();

      return {
        ok: true,
        batchId,
        variantId,
        batch: {
          start: this.r2((b as any).start),
          in: this.r2((b as any).in),
          out: this.r2((b as any).out),
          balance: this.r2((b as any).balance),
          startOFR: this.r2((b as any).startOFR),
          inOFR: this.r2((b as any).inOFR),
          outOFR: this.r2((b as any).outOFR),
          balanceOFR: this.r2((b as any).balanceOFR),
        },
        variantTotalsNow: {
          totalStart: this.r2((v as any).totalStart),
          totalIn: this.r2((v as any).totalIn),
          totalOut: this.r2((v as any).totalOut),
          totalBalance: this.r2((v as any).totalBalance),
          totalStartOFR: this.r2((v as any).totalStartOFR),
          totalInOFR: this.r2((v as any).totalInOFR),
          totalOutOFR: this.r2((v as any).totalOutOFR),
          totalBalanceOFR: this.r2((v as any).totalBalanceOFR),
        },
      };
    } catch (e) {
      try { await qr.rollbackTransaction(); } catch {}
      throw e;
    } finally {
      try { await qr.release(); } catch {}
    }
  }
}











