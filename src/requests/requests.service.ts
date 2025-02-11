import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { Customer } from '../entities/customer.entity';

@Injectable()
export class RequestService {
  constructor(
    @InjectRepository(Request) private requestRepo: Repository<Request>,
    @InjectRepository(RequestDetail)
    private detailRepo: Repository<RequestDetail>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
  ) {}

  async createRequest(data: any): Promise<Request> {
    const {
      requestDate,
      totalAmount,
      vatAmount,
      grandTotal,
      customerId,
      details,
    } = data;

    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new Error('Customer not found');
    }

    const request = this.requestRepo.create({
      requestDate,
      totalAmount,
      vatAmount,
      grandTotal,
      customer,
      details: details.map((detail) => this.detailRepo.create(detail)),
    });

    return await this.requestRepo.save(request);
  }

  async getAllRequests(): Promise<Request[]> {
    return this.requestRepo.find({ relations: ['customer', 'details'] });
  }

  async getRequestById(id: number): Promise<Request> {
    return this.requestRepo.findOne({
      where: { id },
      relations: ['customer', 'details'],
    });
  }
}
