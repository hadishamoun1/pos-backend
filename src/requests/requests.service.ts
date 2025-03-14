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

    // ✅ Find the last request number **correctly**
    const lastRequest = await this.requestRepo
      .createQueryBuilder('request')
      .select(
        "CAST(SUBSTRING_INDEX(request.requestNumber, ' - ', -1) AS UNSIGNED) AS maxNumber",
      )
      .where('request.requestNumber LIKE :prefix', { prefix: `${prefix} - %` })
      .orderBy('maxNumber', 'DESC')
      .limit(1)
      .getRawOne();

    // ✅ Ensure correct numbering
    const newRequestNumber = lastRequest?.maxNumber
      ? parseInt(lastRequest.maxNumber) + 1
      : 1;
    const requestNumber = `${prefix} - ${newRequestNumber}`;

    // ✅ Validate and Link Item Variants
    const requestDetails = await Promise.all(
      details.map(async (detail) => {
        const { itemVariantId, quantity, sqm, price, total } = detail;

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

    // ✅ Create and Save Request
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

  async getRequestById(id: number): Promise<any> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: [
        'customer',
        'details',
        'details.itemVariant',
        'details.itemVariant.thickness',
        'details.itemVariant.thickness.item',
      ],
    });
  
    if (!request) {
      throw new NotFoundException(`Request with ID ${id} not found.`);
    }
  
    return {
      id: request.id,
      requestNumber: request.requestNumber,
      requestDate: request.requestDate,
      totalAmount: request.totalAmount,
      vatAmount: request.vatAmount,
      grandTotal: request.grandTotal,
      customerId: request.customer?.id || null, // ✅ Prevent null errors
      customerName: request.customer?.customerName || 'Unknown', // ✅ Fallback for missing name
      invoiceType: request.customer?.invoiceType || 'Both', // ✅ Default to 'Both' if missing
      details: request.details.map((detail) => ({
        itemVariantId: detail.itemVariant?.id || null,
        itemName: detail.itemVariant?.thickness?.item?.itemName || 'Unknown',
        thickness: detail.itemVariant?.thickness?.thickness || 'Unknown',
        length: detail.itemVariant?.length || 0,
        width: detail.itemVariant?.width || 0,
        origin: detail.itemVariant?.origin || 'Unknown',
        sheetsPerBox: detail.itemVariant?.sheetsPerBox || 0,
        itemType: detail.itemVariant?.thickness?.item?.type || 'Unknown',
        quantity: detail.quantity || 0,
        sqm: detail.sqm || 0,
        price: detail.price || 0,
        total: detail.total || 0,
      })),
    };
  }
  
  async getFilteredRequests() {
    const requests = await this.requestRepo.find({
      select: [
        'id',
        'requestNumber',
        'requestDate',
        'totalAmount',
        'vatAmount',
        'grandTotal',
      ],
      relations: ['customer'],
      order: { requestDate: 'DESC' },  
    });

    return requests.map((request) => ({
      id: request.id,
      requestNumber: request.requestNumber,
      requestDate: request.requestDate,
      totalAmount: request.totalAmount,
      vatAmount: request.vatAmount,
      grandTotal: request.grandTotal,
      customerName: request.customer?.customerName || 'Unknown', 
      customerId:request.customer?.id,
      invoiceType: request.customer?.invoiceType || 'Both', 
    }));
  }
}
