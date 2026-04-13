import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';

@Injectable()
export class ItemNameDescriptionService {
  constructor(
    @InjectRepository(ItemNameDescription)
    private readonly descRepo: Repository<ItemNameDescription>,
  ) {}

  async create(
    data: Partial<ItemNameDescription>,
  ): Promise<ItemNameDescription> {
    const desc = this.descRepo.create(data);
    return await this.descRepo.save(desc);
  }

  async findAll(): Promise<ItemNameDescription[]> {
    return await this.descRepo.find({ relations: ['item'] });
  }

  async findOne(id: number): Promise<ItemNameDescription> {
    const desc = await this.descRepo.findOne({
      where: { id },
      relations: ['item'],
    });
    if (!desc) throw new NotFoundException(`Description #${id} not found`);
    return desc;
  }

  async update(
    id: number,
    data: Partial<ItemNameDescription>,
  ): Promise<ItemNameDescription> {
    const desc = await this.findOne(id);
    Object.assign(desc, data);
    return await this.descRepo.save(desc);
  }

  async remove(id: number): Promise<void> {
    const desc = await this.findOne(id);
    await this.descRepo.remove(desc);
  }
}
