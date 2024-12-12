import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Categories } from '../entities/categories.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Categories)
    private categoriesRepository: Repository<Categories>,
  ) {}

  async findAll(): Promise<Categories[]> {
    return this.categoriesRepository.find();
  }

  async findOneById(id: number): Promise<Categories | undefined> {
    return this.categoriesRepository.findOneBy({ id });
  }

  async findOneByCode(categoriesCode: string): Promise<Categories | undefined> {
    return this.categoriesRepository.findOneBy({ categoriesCode });
  }

  async create(categories: Categories): Promise<Categories> {
    return this.categoriesRepository.save(categories);
  }

  async update(id: number, categories: Partial<Categories>): Promise<void> {
    await this.categoriesRepository.update(id, categories);
  }

  async delete(id: number): Promise<void> {
    await this.categoriesRepository.delete(id);
  }
}
