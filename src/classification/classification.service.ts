import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Classification } from '../entities/classification.entity';

@Injectable()
export class ClassificationService {
  constructor(
    @InjectRepository(Classification)
    private readonly classificationRepository: Repository<Classification>,
  ) {}

  findAll() {
    return this.classificationRepository.find();
  }

  findOne(classificationCode: string) {
    return this.classificationRepository.findOneBy({ classificationCode });
  }

  create(classification: Classification) {
    return this.classificationRepository.save(classification);
  }

  update(classificationCode: string, classification: Partial<Classification>) {
    return this.classificationRepository.update(
      classificationCode,
      classification,
    );
  }

  delete(classificationCode: string) {
    return this.classificationRepository.delete(classificationCode);
  }
}
