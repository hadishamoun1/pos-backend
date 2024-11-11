// purchaseInvoice.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';
import { PurchaseItem } from '../entities/purchaseItem.entity';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private purchaseInvoiceRepository: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseItem)
    private purchaseItemRepository: Repository<PurchaseItem>,
  ) {}

  async createPurchaseInvoice(data: any): Promise<PurchaseInvoice> {
    // Create purchase invoice with items and save to the database
    const purchaseInvoice = this.purchaseInvoiceRepository.create(data);
    await this.purchaseInvoiceRepository.save(purchaseInvoice);
    // Update inventory by incrementing `quantityUnopenedBoxes` for each item
    await Promise.all(data.purchaseItems.map(async (item) => {
      // Adjust inventory logic based on the item.dimensionId and quantity added
    }));
    return purchaseInvoice;
  }
}
