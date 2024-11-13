// item.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from '../entities/inventory/item.entity';

@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(Item)
    private readonly itemRepository: Repository<Item>,
  ) {}

  async createItem(data: Partial<Item>): Promise<Item> {
    const item = this.itemRepository.create(data);
    return this.itemRepository.save(item);
  }

  async findAll(): Promise<Item[]> {
    return this.itemRepository.find({ relations: ['dimensions'] });
  }

  async findOne(id: number): Promise<Item> {
    return this.itemRepository.findOne({
      where: { itemId: id },
      relations: ['dimensions'],
    });
  }

  async updateItem(id: number, data: Partial<Item>): Promise<Item> {
    await this.itemRepository.update(id, data);
    return this.findOne(id);
  }

  async deleteItem(id: number): Promise<void> {
    await this.itemRepository.delete(id);
  }
}
