import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from '../entities/request.entity';
import { RequestItem } from '../entities/request-item.entity';

@Injectable()
export class RequestService {
  constructor(
    @InjectRepository(Request)
    private readonly requestRepository: Repository<Request>,
    @InjectRepository(RequestItem)
    private readonly requestItemRepository: Repository<RequestItem>,
  ) {}

  async createRequest(data: Partial<Request>, items: Partial<RequestItem>[]): Promise<Request> {
    const request = this.requestRepository.create(data);
    request.requestItems = items.map((item) => this.requestItemRepository.create(item));
    return this.requestRepository.save(request);
  }

  async findAll(): Promise<Request[]> {
    return this.requestRepository.find({ relations: ['requestItems'] });
  }

  async findOne(id: number): Promise<Request> {
    return this.requestRepository.findOne({ where: { id }, relations: ['requestItems'] });
  }

  async updateRequest(id: number, data: Partial<Request>): Promise<Request> {
    await this.requestRepository.update(id, data);
    return this.findOne(id);
  }

  async deleteRequest(id: number): Promise<void> {
    await this.requestRepository.delete(id);
  }
}
