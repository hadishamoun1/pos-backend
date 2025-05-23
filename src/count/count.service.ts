// src/inventory-count/inventory-count.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Injectable()
export class InventoryCountService {
  constructor(
    @InjectRepository(InventoryCount)
    private readonly inventoryCountRepo: Repository<InventoryCount>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepo: Repository<ItemVariant>,
  ) {}

  /** internal helper to save one row, now converting cm→m and computing sqm */
  async create(
    createData: any | any[],
  ): Promise<InventoryCount | InventoryCount[]> {
    if (Array.isArray(createData)) {
      const results: InventoryCount[] = [];
      for (const row of createData) {
        results.push(await this.createSingle(row));
      }
      return results;
    } else {
      return this.createSingle(createData);
    }
  }

  /** internal helper to save one row, converting cm→m and computing sqm */
  private async createSingle(data: any): Promise<InventoryCount> {
    const { itemVariantId, date, count, type, unit } = data;

    // 1) fetch the variant
    const variant = await this.itemVariantRepo.findOne({
      where: { id: itemVariantId },
    });
    if (!variant) {
      throw new NotFoundException(`ItemVariant #${itemVariantId} not found`);
    }

    // 2) compute sqm (convert cm²→m² by dividing by 10000)
    const lengthCm = Number(variant.length);
    const widthCm = Number(variant.width);
    const oneSheetM2 = (lengthCm * widthCm) / 10000;

    let sqm: number;
    switch (unit) {
      case 'box':
        sqm = oneSheetM2 * variant.sheetsPerBox * count;
        break;
      case 'sheet':
        sqm = oneSheetM2 * count;
        break;
      case 'sqm':
        sqm = count;
        break;
      default:
        sqm = 0;
    }

    // 3) build and save
    const record = this.inventoryCountRepo.create({
      itemVariant: variant,
      date, // now guaranteed to exist on each row
      count,
      type,
      sqm,
    });
    return this.inventoryCountRepo.save(record);
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

  async update(id: number, updateData: any): Promise<InventoryCount> {
    const rec = await this.findOne(id);

    if (updateData.itemVariantId) {
      const variant = await this.itemVariantRepo.findOne({
        where: { id: updateData.itemVariantId },
      });
      if (!variant) {
        throw new NotFoundException(
          `ItemVariant #${updateData.itemVariantId} not found`,
        );
      }
      rec.itemVariant = variant;
    }

    Object.assign(rec, updateData);
    return this.inventoryCountRepo.save(rec);
  }

  async remove(id: number): Promise<void> {
    await this.inventoryCountRepo.delete(id);
  }
}
