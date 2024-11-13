// dimension.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dimension } from '../entities/inventory/dimension.entity';

@Injectable()
export class DimensionService {
  constructor(
    @InjectRepository(Dimension)
    private readonly dimensionRepository: Repository<Dimension>,
  ) {}

  async createDimension(data: Partial<Dimension>): Promise<Dimension> {
    const dimension = this.dimensionRepository.create(data);
    return this.dimensionRepository.save(dimension);
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
