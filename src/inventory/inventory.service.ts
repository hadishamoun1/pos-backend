import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from '../entities/inventory.entity';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
  ) {}

  // Create a new inventory item
  async create(data: Partial<Inventory>): Promise<Inventory> {
    if (data.type === 'box' && (!data.quantityPerBox || data.sheets)) {
      throw new BadRequestException('For type "box", quantityPerBox is required and sheets should be empty');
    }
    if (data.type === 'sheet' && (!data.sheets || data.quantityPerBox)) {
      throw new BadRequestException('For type "sheet", sheets is required and quantityPerBox should be empty');
    }

    // Ensure totalQuantity is provided
    if (!data.totalQuantity) {
      throw new BadRequestException('totalQuantity is required');
    }

    const newItem = this.inventoryRepository.create(data);
    return this.inventoryRepository.save(newItem);
  }

  // Retrieve all inventory items
  async findAll(): Promise<Inventory[]> {
    return this.inventoryRepository.find();
  }

  // Retrieve a single inventory item by ID
  async findOne(id: number): Promise<Inventory> {
    return this.inventoryRepository.findOne({ where: { id } });
  }

  // Update an inventory item by ID
  async update(id: number, data: Partial<Inventory>): Promise<Inventory> {
    const existingItem = await this.inventoryRepository.findOne({ where: { id } });
    if (!existingItem) {
      throw new BadRequestException('Inventory item not found');
    }

    if (data.type === 'box' && (!data.quantityPerBox || data.sheets)) {
      throw new BadRequestException('For type "box", quantityPerBox is required and sheets should be empty');
    }
    if (data.type === 'sheet' && (!data.sheets || data.quantityPerBox)) {
      throw new BadRequestException('For type "sheet", sheets is required and quantityPerBox should be empty');
    }

    await this.inventoryRepository.update(id, data);
    return this.inventoryRepository.findOne({ where: { id } });
  }

  // Delete an inventory item by ID
  async delete(id: number): Promise<void> {
    await this.inventoryRepository.delete(id);
  }
}
