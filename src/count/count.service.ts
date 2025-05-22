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

  async create(createData: any): Promise<InventoryCount> {
    const { itemVariantId, date, count, type } = createData;
    const variant = await this.itemVariantRepo.findOne({ where: { id: itemVariantId } });
    if (!variant) {
      throw new NotFoundException(`ItemVariant #${itemVariantId} not found`);
    }
    const record = this.inventoryCountRepo.create({
      itemVariant: variant,
      date,
      count,
      type,
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
