import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from '../entities/inventory/item.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private readonly itemRepository: Repository<Item>,
    @InjectRepository(Thickness)
    private readonly thicknessRepository: Repository<Thickness>,
    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,
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
      .leftJoinAndSelect('item.thicknesses', 'thickness')
      .leftJoinAndSelect('thickness.variants', 'variant')
      .select([
        'item.id', // Item fields
        'item.itemName',
        'item.type',
        'thickness.thickness', // Thickness field
        'variant.id',
        'variant.length', // ItemVariant fields
        'variant.width',
        'variant.sheetsPerBox',
        'variant.origin',
      ])
      .getMany();
  }
  async createFullItem(data: {
    itemName: string;
    type: string;
    thicknesses: {
      thickness: number;
      variants: {
        length: number;
        width: number;
        sheetsPerBox: number;
        origin: string;
        fixBox?: boolean;
        fixLength?: boolean;
        fixWidth?: boolean;
      }[];
    }[];
  }): Promise<Item> {
    const { itemName, type, thicknesses } = data;

    // Validate the main item data
    if (!itemName || !type) {
      throw new Error('Item name and type are required.');
    }

    // Create the Item
    const newItem = this.itemRepository.create({ itemName, type });

    // Validate and create Thicknesses and Variants
    if (thicknesses && thicknesses.length > 0) {
      newItem.thicknesses = thicknesses.map((thicknessData) => {
        const { thickness, variants } = thicknessData;

        if (!thickness) {
          throw new Error('Thickness value is required.');
        }

        const newThickness = this.thicknessRepository.create({ thickness });

        if (variants && variants.length > 0) {
          newThickness.variants = variants.map((variantData) => {
            const { length, width, sheetsPerBox, origin } = variantData;

            if (!length || !width || !sheetsPerBox || !origin) {
              throw new Error('Variant details are incomplete.');
            }

            return this.itemVariantRepository.create(variantData);
          });
        }

        return newThickness;
      });
    }

    // Save the Item with related data in a single transaction
    return await this.itemRepository.save(newItem);
  }
}
