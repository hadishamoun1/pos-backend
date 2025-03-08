import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { Customer } from '../entities/customer.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Settings } from '../entities/settings.entity';

@Injectable()
export class RequestService {
  constructor(
    @InjectRepository(Request) private requestRepo: Repository<Request>,
    @InjectRepository(RequestDetail)
    private detailRepo: Repository<RequestDetail>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(ItemVariant)
    private itemVariantRepo: Repository<ItemVariant>,
    @InjectRepository(Settings) private settingsRepo: Repository<Settings>,
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

    // ✅ Get Active Year from Settings
    const activeYear = await this.settingsRepo.findOne({
      where: { isActive: true },
    });
    if (!activeYear) {
      throw new NotFoundException('No active year found in Settings.');
    }
    const year = activeYear.year.slice(-2); // Extract last 2 digits (e.g., '2025' → '25')
    const prefix = `REQ${year}`;

    // ✅ Find the last request for the active year
    const lastRequest = await this.requestRepo.find({
      where: { requestNumber: Like(`${prefix}%`) },
      order: { requestNumber: 'DESC' },
      take: 1,
    });

    // ✅ Generate New Request Number
    const newRequestNumber =
      lastRequest.length > 0
        ? parseInt(lastRequest[0].requestNumber.split(' - ')[1]) + 1
        : 1;
    const requestNumber = `${prefix} - ${newRequestNumber}`;

    // ✅ Validate and Link Item Variants
    const requestDetails = await Promise.all(
      details.map(async (detail) => {
        const { itemVariantId,quantity, sqm, price, total } = detail;

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
          quantity,
          sqm,
          price,
          total,
        });
      }),
    );

    // ✅ Create Request with Generated Request Number
    const request = this.requestRepo.create({
      requestNumber, // ✅ Set Auto-Generated Request Number
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
    const requests = await this.requestRepo.find({
      relations: [
        'customer',
        'details',
        'details.itemVariant',
        'details.itemVariant.thickness',
        'details.itemVariant.thickness.item',
      ],
    });

    return requests.map((request) => ({
      id: request.id,
      requestNumber: request.requestNumber,
      requestDate: request.requestDate,
      totalAmount: request.totalAmount,
      vatAmount: request.vatAmount,
      grandTotal: request.grandTotal,
      customerName: request.customer.customerName,
      details: request.details.map((detail) => ({
        itemVariantId: detail.itemVariant.id, 
        itemName: detail.itemVariant.thickness.item.itemName,
        thickness: detail.itemVariant.thickness.thickness,
        length: detail.itemVariant.length,
        width: detail.itemVariant.width,
        origin: detail.itemVariant.origin,
        sheetsPerBox: detail.itemVariant.sheetsPerBox,
        itemType: detail.itemVariant.thickness.item.type,
        quantity: detail.quantity,
        sqm: detail.sqm,
        price: detail.price,
        total: detail.total,
      })),
    }));
  }
}
