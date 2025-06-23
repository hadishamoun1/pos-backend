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
      // join thickness
      .leftJoinAndSelect('item.thicknesses', 'thickness')
      // join variants
      .leftJoinAndSelect('thickness.variants', 'variant')
      // join batches on each variant
      .leftJoinAndSelect('variant.batches', 'batch')
      // pick just the fields you want
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

        'batch.id',
        'batch.condition',
        'batch.dateReceived',
      ])
      .getMany();
  }

  async createFullItem(data: {
    itemName: string;
    type: 'box' | 'sheet' | 'sqm';
    descriptions?: Array<{
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

    const incoming = rawTh.map((th) => ({
      thickness: Number(th.thickness),
      variants: th.variants.map((v) => ({
        length: type === 'sqm' ? 0 : Number(v.length ?? 0),
        width: type === 'sqm' ? 0 : Number(v.width ?? 0),
        sheetsPerBox: type === 'sheet' ? 1 : Number(v.sheetsPerBox ?? 0),
        origin: v.origin,
        fixBox: v.fixBox ?? false,
        fixLength: v.fixLength ?? false,
        fixWidth: v.fixWidth ?? false,
      })),
    }));

    let item = await this.itemRepository.findOne({
      where: { itemName, type },
      relations: ['thicknesses', 'thicknesses.variants', 'descriptions'],
    });

    const isNewItem = !item;
    if (isNewItem) {
      item = this.itemRepository.create({ itemName, type });

      item.thicknesses = incoming.map((thDto) => {
        const thEnt = this.thicknessRepository.create({
          thickness: thDto.thickness,
        });
        thEnt.variants = thDto.variants.map((vDto) =>
          this.itemVariantRepository.create({
            length: vDto.length,
            width: vDto.width,
            sheetsPerBox: vDto.sheetsPerBox,
            origin: vDto.origin,
            fixBox: vDto.fixBox,
            fixLength: vDto.fixLength,
            fixWidth: vDto.fixWidth,
          }),
        );
        return thEnt;
      });

      item.descriptions = descriptions.map((desc) =>
        this.itemNameDescriptionRepository.create({
          categoryName: desc.categoryName,
          subCategory: desc.subCategory,
          colorName: desc.colorName,
          designName: desc.designName,
        }),
      );

      return this.itemRepository.save(item);
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

      for (const vDto of thDto.variants) {
        const found = thEnt.variants.find(
          (v) =>
            Number(v.length) === vDto.length &&
            Number(v.width) === vDto.width &&
            v.sheetsPerBox === vDto.sheetsPerBox &&
            v.origin === vDto.origin,
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
          });
          await this.itemVariantRepository.save(newVar);
          thEnt.variants.push(newVar);
        }
      }
    }

    for (const desc of descriptions) {
      const exists = item.descriptions.find(
        (d) =>
          d.categoryName === desc.categoryName &&
          d.subCategory === desc.subCategory &&
          d.colorName === desc.colorName &&
          d.designName === desc.designName,
      );
      if (!exists) {
        const newDesc = this.itemNameDescriptionRepository.create({
          categoryName: desc.categoryName,
          subCategory: desc.subCategory,
          colorName: desc.colorName,
          designName: desc.designName,
          item: item,
        });
        await this.itemNameDescriptionRepository.save(newDesc);
        item.descriptions.push(newDesc);
      }
    }

    return item;
  }
}
