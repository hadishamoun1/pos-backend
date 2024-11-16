// dimension.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dimension } from '../entities/inventory/dimension.entity';
import { Item } from '../entities/inventory/item.entity'; 

@Injectable()
export class DimensionService {
  constructor(
    @InjectRepository(Dimension)
    private readonly dimensionRepository: Repository<Dimension>,

    @InjectRepository(Item)
    private readonly itemRepository: Repository<Item>, 
  ) {}

  async createDimension(data: {
    itemId: number;
    length: number;
    width: number;
    sheetsPerBox?: number;
    origin: string;
    quantityUnopenedBoxes?: number;
  }): Promise<Dimension> {
    const {
      itemId,
      length,
      width,
      sheetsPerBox,
      origin,
      quantityUnopenedBoxes,
    } = data;

    // Fetch the related item by itemId
    const item = await this.itemRepository.findOneBy({ itemId });
    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    // Check the item type and conditionally set the fields
    const dimension = this.dimensionRepository.create({
      item,
      length,
      width,
      origin,
      sheetsPerBox: item.type === 'box' ? (sheetsPerBox ?? 1) : null, 
      quantityUnopenedBoxes:
        item.type === 'box' ? (quantityUnopenedBoxes ?? 0) : null, 
    });

    return await this.dimensionRepository.save(dimension);
  }

  async findAll(): Promise<Dimension[]> {
    return this.dimensionRepository.find({ relations: ['item'] });
  }

  async findOne(id: number): Promise<Dimension> {
    return this.dimensionRepository.findOne({
      where: { dimensionId: id },
      relations: ['item'],
    });
  }

  async updateDimension(
    id: number,
    data: Partial<Dimension>,
  ): Promise<Dimension> {
    await this.dimensionRepository.update(id, data);
    return this.findOne(id);
  }

  async deleteDimension(id: number): Promise<void> {
    await this.dimensionRepository.delete(id);
  }
}
