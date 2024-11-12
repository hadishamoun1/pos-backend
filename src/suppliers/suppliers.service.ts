// supplier.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../entities/suppliers.entity';

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
  ) {}

  async findAll(): Promise<Supplier[]> {
    return await this.supplierRepository.find();
  }

  async findOne(id: number): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({ where: { id } });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${id} not found`);
    }
    return supplier;
  }

  async create(supplierData: Partial<Supplier>): Promise<Supplier> {
    const supplier = this.supplierRepository.create(supplierData);
    return await this.supplierRepository.save(supplier);
  }

  async update(id: number, supplierData: Partial<Supplier>): Promise<Supplier> {
    const supplier = await this.findOne(id);
    Object.assign(supplier, supplierData);
    return await this.supplierRepository.save(supplier);
  }

  async delete(id: number): Promise<void> {
    const result = await this.supplierRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Supplier with ID ${id} not found`);
    }
  }
}
