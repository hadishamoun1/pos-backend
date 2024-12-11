import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Categories } from '../entities/categories.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Categories)
    private readonly categoriesRepository: Repository<Categories>,
  ) {}

  findAll() {
    return this.categoriesRepository.find();
  }

  findOne(categoriesCode: string) {
    return this.categoriesRepository.findOneBy({ categoriesCode });
  }

  create(categories: Categories) {
    return this.categoriesRepository.save(categories);
  }

  update(categoriesCode: string, categories: Partial<Categories>) {
    return this.categoriesRepository.update(categoriesCode, categories);
  }

  delete(categoriesCode: string) {
    return this.categoriesRepository.delete(categoriesCode);
  }
}
