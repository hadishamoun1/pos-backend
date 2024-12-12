import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Classification } from '../entities/classification.entity';

@Injectable()
export class ClassificationService {
  constructor(
    @InjectRepository(Classification)
    private classificationRepository: Repository<Classification>,
  ) {}

  async findAll(): Promise<Classification[]> {
    return this.classificationRepository.find();
  }

  async findOneById(id: number): Promise<Classification | undefined> {
    return this.classificationRepository.findOneBy({ id });
  }

  async findOneByCode(
    classificationCode: string,
  ): Promise<Classification | undefined> {
    return this.classificationRepository.findOneBy({ classificationCode });
  }

  async create(classification: Classification): Promise<Classification> {
    return this.classificationRepository.save(classification);
  }

  async update(
    id: number,
    classification: Partial<Classification>,
  ): Promise<void> {
    await this.classificationRepository.update(id, classification);
  }

  async delete(id: number): Promise<void> {
    await this.classificationRepository.delete(id);
  }
}
