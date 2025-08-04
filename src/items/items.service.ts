import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from '../entities/inventory/item.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';

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

  async getSelectedItemDetails(): Promise<any[]> {
    return await this.itemRepository
      .createQueryBuilder('item')
      // join item descriptions
      .leftJoinAndSelect('item.descriptions', 'description')
      // join thickness
      .leftJoinAndSelect('item.thicknesses', 'thickness')
      // join variants
      .leftJoinAndSelect('thickness.variants', 'variant')
      // join the description linked to each variant
      .leftJoinAndSelect('variant.itemNameDescription', 'variantDescription')
      // join batches
      .leftJoinAndSelect('variant.batches', 'batch')
      // select only the needed fields
      .select([
        'item.id',
        'item.itemName',
        'item.type',

        'description.id',
        'description.categoryName',
        'description.subCategory',
        'description.colorName',
        'description.designName',

        'thickness.id',
        'thickness.thickness',

        'variant.id',
        'variant.length',
        'variant.width',
        'variant.sheetsPerBox',
        'variant.origin',

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
      .orderBy('description.id', 'DESC')
      .getMany();
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
      }>[];
    }>;
  }): Promise<Item> {
    const { itemName, type, thicknesses: rawTh, descriptions = [] } = data;

    // Step 1: Convert all values to numbers where needed
    const incoming = rawTh.map((th) => ({
      thickness: Number(th.thickness),
      variants: Array.isArray(th.variants)
        ? th.variants.map((v: any) => ({
            length: type === 'sqm' ? 0 : Number(v?.length ?? 0),
            width: type === 'sqm' ? 0 : Number(v?.width ?? 0),
            sheetsPerBox: type === 'sheet' ? 1 : Number(v?.sheetsPerBox ?? 0),
            origin: v?.origin ?? '',
            fixBox: v?.fixBox ?? false,
            fixLength: v?.fixLength ?? false,
            fixWidth: v?.fixWidth ?? false,
          }))
        : [],
    }));

    // Step 2: Check if item already exists
    let item = await this.itemRepository.findOne({
      where: { itemName, type },
      relations: ['thicknesses', 'thicknesses.variants', 'descriptions'],
    });

    const isNewItem = !item;

    if (isNewItem) {
      // Step 3: Create new item
      item = this.itemRepository.create({ itemName, type });

      // Step 4: Create and save descriptions
      const descEntities = descriptions.map((desc) =>
        this.itemNameDescriptionRepository.create({
          itemNumber: desc.itemNumber,
          categoryName: desc.categoryName,
          subCategory: desc.subCategory,
          colorName: desc.colorName,
          designName: desc.designName,
        }),
      );
      item.descriptions = descEntities;

      // Save the item first so we can assign itemId to descriptions
      item = await this.itemRepository.save(item);

      for (const desc of descEntities) {
        desc.itemId = item.id;
        await this.itemNameDescriptionRepository.save(desc);
      }

      // Step 5: Create thicknesses and variants
      item.thicknesses = [];

      for (const thDto of incoming) {
        const thEnt = this.thicknessRepository.create({
          thickness: thDto.thickness,
          item,
        });

        thEnt.variants = thDto.variants.map((vDto, idx) => {
          const matchingDesc = descEntities[idx] ?? null;

          return this.itemVariantRepository.create({
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            fixBox: vDto.fixBox,
            fixLength: vDto.fixLength,
            fixWidth: vDto.fixWidth,
            itemNameDescription: matchingDesc,
          });
        });

        item.thicknesses.push(thEnt);
      }

      return this.itemRepository.save(item);
    }

    // Step 6: If item already exists, add missing descriptions and thicknesses
    for (const desc of descriptions) {
      const exists = item.descriptions?.some(
        (d) =>
          d.itemNumber === desc.itemNumber &&
          d.categoryName === desc.categoryName &&
          d.subCategory === desc.subCategory &&
          d.colorName === desc.colorName &&
          d.designName === desc.designName,
      );

      if (!exists) {
        const newDesc = this.itemNameDescriptionRepository.create({
          item: item,
          itemNumber: desc.itemNumber,
          categoryName: desc.categoryName,
          subCategory: desc.subCategory,
          colorName: desc.colorName,
          designName: desc.designName,
        });
        await this.itemNameDescriptionRepository.save(newDesc);
        item.descriptions.push(newDesc);
      }
    }

    for (const thDto of incoming) {
      let thEnt = item.thicknesses.find(
        (t) => Number(t.thickness) === thDto.thickness,
      );

      if (!thEnt) {
        thEnt = this.thicknessRepository.create({
          thickness: thDto.thickness,
          item,
        });
        await this.thicknessRepository.save(thEnt);
        item.thicknesses.push(thEnt);
      }

      thEnt.variants = thEnt.variants || [];

      for (const [i, vDto] of thDto.variants.entries()) {
        const matchingDesc = descriptions[i]
          ? await this.itemNameDescriptionRepository.findOne({
              where: {
                itemNumber:   descriptions[i].itemNumber,
                categoryName: descriptions[i].categoryName,
                subCategory: descriptions[i].subCategory,
                colorName: descriptions[i].colorName,
                designName: descriptions[i].designName,
                item: { id: item.id },
              },
            })
          : null;

        const found = thEnt.variants.find(
          (v) =>
            Number(v.length) === vDto.length &&
            Number(v.width) === vDto.width &&
            v.sheetsPerBox === vDto.sheetsPerBox &&
            v.origin === vDto.origin &&
            v.itemNameDescription?.id === matchingDesc?.id,
        );

        if (!found) {
          const newVar = this.itemVariantRepository.create({
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            fixBox: vDto.fixBox,
            fixLength: vDto.fixLength,
            fixWidth: vDto.fixWidth,
            thickness: thEnt,
            itemNameDescription: matchingDesc ?? undefined,
          });

          await this.itemVariantRepository.save(newVar);
          thEnt.variants.push(newVar);
        }
      }
    }

    return item;
  }

  async getitemDetails(): Promise<any[]> {
    const items = await this.itemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.descriptions', 'description')
      .leftJoinAndSelect('item.thicknesses', 'thickness')
      .leftJoinAndSelect('thickness.variants', 'variant')
      .leftJoinAndSelect('variant.itemNameDescription', 'variantDescription')
      .leftJoinAndSelect('variant.batches', 'batch')
      .select([
        'item.id',
        'item.itemName',
        'item.type',

        'description.id',
        'description.categoryName',
        'description.subCategory',
        'description.colorName',
        'description.designName',

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
      .orderBy('description.id', 'DESC')
      .getMany();

    const result = [];

    items.forEach((item) => {
      item.thicknesses.forEach((thickness) => {
        thickness.variants.forEach((variant) => {
          result.push({
            itemId: item.id,
            itemName: item.itemName,
            type: item.type,
            thickness: Number(thickness.thickness),
            length: Number(variant.length),
            width: Number(variant.width),
            sheetsPerBox: variant.sheetsPerBox,
            origin: variant.origin,
            itemNameDescriptionId: variant.itemNameDescriptionId,
            itemNameDescription: variant.itemNameDescription
              ? {
                  id: variant.itemNameDescription.id,
                  categoryName: variant.itemNameDescription.categoryName,
                  subCategory: variant.itemNameDescription.subCategory,
                  colorName: variant.itemNameDescription.colorName,
                  designName: variant.itemNameDescription.designName,
                }
              : null,
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
}
