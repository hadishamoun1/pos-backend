import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { Customer } from '../entities/customer.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Injectable()
export class RequestService {
  constructor(
    @InjectRepository(Request) private requestRepo: Repository<Request>,
    @InjectRepository(RequestDetail)
    private detailRepo: Repository<RequestDetail>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(ItemVariant)
    private itemVariantRepo: Repository<ItemVariant>,
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

    // ✅ Validate Customer
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // ✅ Validate and Link Item Variants
    const requestDetails = await Promise.all(
      details.map(async (detail) => {
        const { itemVariantId, sqm, price, total } = detail;

        const itemVariant = await this.itemVariantRepo.findOne({
          where: { id: itemVariantId },
          relations: ['thickness', 'thickness.item'],
        });
        if (!itemVariant) {
          throw new NotFoundException(
            `ItemVariant with ID ${itemVariantId} not found.`,
          );
        }

        return this.detailRepo.create({
          itemVariant,
          sqm,
          price,
          total,
        });
      }),
    );

    // ✅ Create Request with Details
    const request = this.requestRepo.create({
      requestDate,
      totalAmount,
      vatAmount,
      grandTotal,
      customer,
      details: requestDetails,
    });

    return await this.requestRepo.save(request);
  }

  async getAllRequests(): Promise<Request[]> {
    return this.requestRepo.find({
      relations: [
        'customer',
        'details',
        'details.itemVariant',
        'details.itemVariant.thickness',
        'details.itemVariant.thickness.item',
      ],
    });
  }

  async getRequestById(id: number): Promise<Request> {
    return this.requestRepo.findOne({
      where: { id },
      relations: [
        'customer',
        'details',
        'details.itemVariant',
        'details.itemVariant.thickness',
        'details.itemVariant.thickness.item',
      ],
    });
  }

  async getFilteredRequests() {
    const requests = await this.getAllRequests();
    return requests.map((request) => ({
      id: request.id,
      requestDate: request.requestDate,
      totalAmount: request.totalAmount,
      vatAmount: request.vatAmount,
      grandTotal: request.grandTotal,
      customerName: request.customer.customerName,
      details: request.details.map((detail) => ({
        itemName: detail.itemVariant.thickness.item.itemName,
        thickness: detail.itemVariant.thickness.thickness,
        length: detail.itemVariant.length,
        width: detail.itemVariant.width,
        origin: detail.itemVariant.origin,
        sqm: detail.sqm,
        price: detail.price,
        total: detail.total,
      })),
    }));
  }
}
