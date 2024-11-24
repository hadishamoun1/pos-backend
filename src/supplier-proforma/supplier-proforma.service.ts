import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierProforma } from '../entities/supplierProforma.entity';

@Injectable()
export class SupplierProformaService {
  constructor(
    @InjectRepository(SupplierProforma)
    private readonly supplierProformaRepository: Repository<SupplierProforma>,
  ) {}

  async create(
    supplierProformaData: Partial<SupplierProforma>,
  ): Promise<SupplierProforma> {
    const supplierProforma =
      this.supplierProformaRepository.create(supplierProformaData);
    return this.supplierProformaRepository.save(supplierProforma);
  }

  async findAll(): Promise<SupplierProforma[]> {
    return this.supplierProformaRepository.find();
  }

  async findOne(id: number): Promise<SupplierProforma> {
    const supplierProforma = await this.supplierProformaRepository.findOne({
      where: { id },
    });
    if (!supplierProforma) {
      throw new NotFoundException(`SupplierProforma with ID ${id} not found`);
    }
    return supplierProforma;
  }

  async update(
    id: number,
    updateData: Partial<SupplierProforma>,
  ): Promise<SupplierProforma> {
    await this.findOne(id); // Ensure the entity exists
    await this.supplierProformaRepository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id); // Ensure the entity exists
    await this.supplierProformaRepository.delete(id);
  }
}
