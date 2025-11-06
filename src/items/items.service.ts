import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

// items.service.ts
// items.service.ts
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
  // Convert Map to array preserving insertion order
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

  // ──────────────────────────────────────────────
  // Normalization helpers
  // ──────────────────────────────────────────────
  const normalizeDigits = (s: string) => {
    if (!s) return '';
    const map: Record<string, string> = {
      // Arabic-Indic
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
      // Extended Arabic-Indic (Persian/Urdu)
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    };
    return String(s).replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
  };

  const normalizeText = (s: string) => {
    if (s == null) return '';
    // unify spaces (incl NBSP) → normal spaces, unify en/em dash to '-', collapse internal spaces, trim, normalize digits
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

  const fpOf = (args: {
    thickness: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string;
    descId: number | null;
  }) =>
    [
      args.thickness,
      args.length,
      args.width,
      args.sheetsPerBox,
      (args.origin ?? '').trim(),
      args.descId ?? 'null',
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

  // Resolve or create a description entity 1:1 by normalized fields
  const resolveOrCreateDesc = async (desc: {
    itemNumber: string;
    categoryName: string;
    subCategory: string;
    colorName: string;
    designName: string;
  }): Promise<{ ent: any; isNew: boolean }> => {
    const where = {
      itemNumber:  normalizeText(desc.itemNumber ?? ''),
      categoryName: normalizeText(desc.categoryName ?? ''),
      subCategory:  normalizeText(desc.subCategory ?? ''),
      colorName:    normalizeText(desc.colorName ?? ''),
      designName:   normalizeText(desc.designName ?? ''),
    };
    let ent = await this.itemNameDescriptionRepository.findOne({ where });
    if (!ent) {
      ent = this.itemNameDescriptionRepository.create(where);
      ent = await this.itemNameDescriptionRepository.save(ent);
      return { ent, isNew: true };
    }
    return { ent, isNew: false };
  };

  /**
   * Upsert item of a specific type.
   * Returns: the item + a map of thickness -> newly created variant fingerprints.
   */
  const upsertItemWith = async (
    targetType: 'box' | 'sheet' | 'sqm',
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
        descId?: number | null;
      }>;
    }>,
    descEntities: any[],
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
      ],
    });

    const createdByThickness = new Map<number, string[]>();

    if (!item) {
      item = this.itemRepository.create({ itemName, type: targetType });
      item = await this.itemRepository.save(item);
      item.thicknesses = [];

      for (const thDto of incoming) {
        const thEnt = this.thicknessRepository.create({
          thickness: thDto.thickness,
          item,
        });

        thEnt.variants = thDto.variants.map((vDto, idx) => {
          const desc = (Number.isFinite(thDto.variants[idx]?.descId)
            ? { id: thDto.variants[idx].descId }
            : descEntities[idx]) ?? null;

          return this.itemVariantRepository.create({
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            fixBox: vDto.fixBox,
            fixLength: vDto.fixLength,
            fixWidth: vDto.fixWidth,
            itemNameDescription: desc ?? undefined,
          });
        });

        const savedTh = await this.thicknessRepository.save(thEnt);
        item.thicknesses.push(savedTh);

        const fps = thDto.variants.map((vDto, idx) =>
          fpOf({
            thickness: thDto.thickness,
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            descId: Number.isFinite(thDto.variants[idx]?.descId)
              ? Number(thDto.variants[idx].descId)
              : descEntities[idx]?.id ?? null,
          }),
        );
        createdByThickness.set(thDto.thickness, fps);
      }

      return { item, createdByThickness };
    }

    // Existing item → idempotent upsert
    for (const thDto of incoming) {
      let thEnt =
        item.thicknesses?.find(
          (t) => Number(t.thickness) === Number(thDto.thickness),
        ) ?? null;

      if (!thEnt) {
        thEnt = this.thicknessRepository.create({
          thickness: thDto.thickness,
          item,
        });
        thEnt = await this.thicknessRepository.save(thEnt);
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
            descId: v.itemNameDescription?.id ?? null,
          }),
        ),
      );

      const createdFps: string[] = [];

      for (let i = 0; i < thDto.variants.length; i++) {
        const vDto = thDto.variants[i];
        const mappedDesc =
          (Number.isFinite(vDto?.descId) ? { id: vDto.descId } : descEntities[i]) ?? null;

        const fp = fpOf({
          thickness: Number(thDto.thickness),
          length: Number(vDto.length),
          width: Number(vDto.width),
          sheetsPerBox: Number(vDto.sheetsPerBox),
          origin: vDto.origin ?? '',
          descId: mappedDesc?.id ?? null,
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
          itemNameDescription: mappedDesc ?? undefined,
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

  // Build SQM incoming for ONE description only (one 0x0 variant per thickness)
  const buildSQMIncomingForOneDesc = (thicknessValues: number[], singleDescId: number | null) => {
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
          descId: singleDescId ?? null,
        },
      ],
    }));
  };

  // ──────────────────────────────────────────────
  // 1) Resolve descriptions & track NEW ones (normalized)
  // ──────────────────────────────────────────────
  const descEntities: any[] = [];
  const newDescEntities: any[] = [];
  for (const d of descriptions) {
    const { ent, isNew } = await resolveOrCreateDesc(d);
    descEntities.push(ent);
    if (isNew) newDescEntities.push(ent);
  }

  // collect unique thickness values from payload
  const uniqueThicknesses = Array.from(
    new Set((rawTh ?? []).map((t) => toNum(t.thickness))).values(),
  ).filter((n) => Number.isFinite(n));

  // ──────────────────────────────────────────────
  // 2) Upsert the requested item TYPE (main)
  // ──────────────────────────────────────────────
  const incomingForRequested = normalizeForType(type);
  const { item: mainItem, createdByThickness } = await upsertItemWith(
    type,
    incomingForRequested,
    descEntities,
  );

  // ──────────────────────────────────────────────
  // 3) If 'box' → mirror ONLY the newly created variants to 'sheet'
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
      descId: number | null;
    };
    type MirrorPayload = Array<{
      thickness: number;
      variants: MirrorVariant[];
    }>;

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
            const mappedDesc =
              (Number.isFinite((v as any)?.descId) ? { id: (v as any).descId } : descEntities[idx]) ?? null;

            const candidateNoSpb = keyWithoutSpb(
              [
                th.thickness,
                v.length,
                v.width,
                0,                  // placeholder (dropped)
                v.origin ?? '',
                mappedDesc?.id ?? 'null',
              ].join('|'),
            );

            if (!createdNoSpb.has(candidateNoSpb)) return null;

            return {
              length: Number(v.length),
              width: Number(v.width),
              sheetsPerBox: 1,     // SHEET uses 1
              origin: v.origin ?? '',
              fixBox: !!v.fixBox,
              fixLength: !!v.fixLength,
              fixWidth: !!v.fixWidth,
              descId: mappedDesc?.id ?? null,
            } as MirrorVariant;
          })
          .filter((x): x is MirrorVariant => Boolean(x));

        if (filteredVariants.length === 0) return null;

        return {
          thickness: Number(th.thickness),
          variants: filteredVariants,
        };
      })
      .filter((x): x is MirrorPayload[number] => Boolean(x));

    if (createdOnlyForSheet.length > 0) {
      await upsertItemWith('sheet', createdOnlyForSheet, descEntities);
    }
  }

  // ──────────────────────────────────────────────
  // 4) SQM for NEW descriptions (unchanged logic)
  // ──────────────────────────────────────────────
  if (newDescEntities.length > 0 && uniqueThicknesses.length > 0) {
    for (const newDesc of newDescEntities) {
      const sqmIncoming = buildSQMIncomingForOneDesc(uniqueThicknesses, newDesc.id ?? null);
      await upsertItemWith('sqm', sqmIncoming, [newDesc]);
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

// items.service.ts
async editFullItem(editDto: {
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
      description?: { id?: number } | null;
    }>;
  }>;
}): Promise<Item> {
  const toNum = (v: any, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const normType = (t?: string) =>
    (t === 'box' || t === 'sheet' || t === 'sqm') ? t : 'box';

  const tag = (s: string) => `[editFullItem] ${s}`;
  const j = (o: any) => JSON.stringify(o);

  console.log(tag('Incoming DTO:'), j(editDto));

  const { itemId, itemName, type } = editDto;
  const tType = normType(type);

  // 1) Load item with relations (thicknesses + variants)
  let item: Item | null = null;
  if (itemId) {
    console.log(tag(`Loading item by id=${itemId} with relations...`));
    item = await this.itemRepository.findOne({
      where: { id: itemId },
      relations: [
        'thicknesses',
        'thicknesses.variants',
        'thicknesses.variants.itemNameDescription',
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

  // Optional: cache for description entities
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
        relations: ['thickness', 'thickness.item', 'itemNameDescription'],
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

      // Keep current description UNCHANGED unless description.id is explicitly provided.
      let nextDesc = targetVariant.itemNameDescription ?? null;
      if (vDto.description && typeof vDto.description === 'object' && 'id' in vDto.description!) {
        const newDescId = Number(vDto.description!.id);
        if (Number.isFinite(newDescId)) {
          nextDesc = await getDescById(newDescId); // will throw if id doesn't exist
          console.log(tag('Re-linked description to id=' + newDescId));
        }
      }

      // Apply updates
      targetVariant.length = next.length;
      targetVariant.width = next.width;
      targetVariant.sheetsPerBox = next.sheetsPerBox;
      targetVariant.origin = next.origin;
      targetVariant.fixBox = next.fixBox;
      targetVariant.fixLength = next.fixLength;
      targetVariant.fixWidth = next.fixWidth;
      targetVariant.itemNameDescription = nextDesc;

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

  // Reload and return updated item
  const updated = await this.itemRepository.findOne({
    where: { id: item.id },
    relations: [
      'thicknesses',
      'thicknesses.variants',
      'thicknesses.variants.itemNameDescription',
    ],
  });

  console.log(tag('Done. Returning updated item id=' + item.id));
  return updated!;
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
    .leftJoinAndSelect("variant.realDescription", "realDesc") // 🔁 switched here
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
      "variant.realDescriptionId", // 🔁 switched here
      // real description
      "realDesc.id",
      "realDesc.categoryName",
      "realDesc.subCategory",
      "realDesc.colorName",
      "realDesc.designName",
      "realDesc.sort_index_real_description", // 🔁 switched here
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
  // 2) Flatten (FILTER OUT ZERO/NEGATIVE STOCK)
  // -------------------------------------------------------------------
  type Flat = {
    // item
    itemId: number;
    itemName: string;
    itemSortIndex: number | null;
    type: string; // 'box' | 'sheet' | 'sqm' | 'unit'
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
    for (const th of item.thicknesses || []) {
      for (const v of th.variants || []) {
        const lengthNum = toNum(v.length);
        const widthNum  = toNum(v.width);
        const spbNum    = Math.max(1, toNum(v.sheetsPerBox));

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
          .filter((bb) => toNum(bb.balanceOFR) > 0);

        if (!batches.length) continue;

        const d = (v as any).realDescription || null; // 🔁 switched here
        const realDescLabel =
          d
            ? [
                d.categoryName ?? "",
                d.subCategory ?? "",
                d.colorName ?? "",
                d.designName ?? "",
              ].join(" | ")
            : "ZZZ (No Description)";

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
          realDescId: (v as any).realDescriptionId ?? null, // 🔁 switched here
          realDescSortIndex: d?.sort_index_real_description ?? null, // 🔁 switched here
          realDescLabel,
          realDescriptionId: (v as any).realDescriptionId || null, // 🔁 switched here
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
  // 3) ORDERING (same logic, keyed by real description)
  // -------------------------------------------------------------------
  const nullLastNum = (n: any) => (n == null ? Number.POSITIVE_INFINITY : Number(n));
  const byDesc = new Map<number | 'null', Flat[]>();

  for (const r of flat) {
    const key = r.realDescId ?? 'null';
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
      const dimmed    = rowsTh.filter((r) => r.length > 0 && r.width > 0);
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
        const boxes  = g
          .filter((x) => x.type === "box")
          .sort((a, b) => (b.sheetsPerBox || 0) - (a.sheetsPerBox || 0) || a.variantId - b.variantId);

        const sheets = g
          .filter((x) => x.type === "sheet")
          .sort((a, b) => a.variantId - b.variantId);

        const sqms   = g.filter((x) => x.type === "sqm");
        ordered.push(...boxes, ...sheets, ...sqms);
      }

      // place unspecified dims after (same as before)
      const sqmOthers    = nonDimmed.filter((x) => x.type === "sqm").sort((a, b) => a.variantId - b.variantId);
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
    variantId: number;
    thickness: number;
    length: number;
    width: number;
    sheetsPerBox: number;
    origin: string | null;
    realDescriptionId: number | null; // 🔁 switched here
    realDescription: any | null;      // 🔁 switched here
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
        variantId: r.variantId,
        thickness: r.thickness,
        length: r.length,
        width: r.width,
        sheetsPerBox: r.sheetsPerBox,
        origin: r.origin,
        realDescriptionId: r.realDescriptionId,   // 🔁 switched here
        realDescription: r.realDescription,       // 🔁 switched here
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
    // 🔁 swap to RealDescription
    .leftJoinAndSelect('v.realDescription', 'r')
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
      // real description (ordering + labels)
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

  // ---------- ORDERING (by real description, then thickness, then length) ----------
  qb
    .addSelect('CASE WHEN r.sort_index_real_description IS NULL THEN 1 ELSE 0 END', 'r_nulls')
    .addSelect('CASE WHEN t.sort_index IS NULL THEN 1 ELSE 0 END', 't_nulls');

  qb
    // 1) RealDescription: non-null first, then by sort index
    .orderBy('r_nulls', 'ASC')
    .addOrderBy('r.sort_index_real_description', 'ASC')
    // 2) Thickness: non-null first, then value, then numeric thickness
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

    // 🔁 description now from RealDescription (v.realDescription)
    const rd: any = (v as any).realDescription ?? null;

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

      // keep the same outward shape
      description: rd
        ? {
            id: rd.id ?? null,
            categoryName: rd.categoryName ?? null,
            subCategory:  rd.subCategory ?? null,
            colorName:    rd.colorName ?? null,
            designName:   rd.designName ?? null,
            // expose real description's sort index under the same key name if callers expect it
            sortIndexDescription: rd.sort_index_real_description ?? null,
            itemNumber:  rd.itemNumber ?? null,
          }
        : null,

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

}







