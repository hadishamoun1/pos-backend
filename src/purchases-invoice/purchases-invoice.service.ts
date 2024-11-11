import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';
import { PurchaseItem } from '../entities/purchaseItem.entity';
import { Dimension } from '../entities/inventory/dimension.entity';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private purchaseInvoiceRepository: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseItem)
    private purchaseItemRepository: Repository<PurchaseItem>,
    @InjectRepository(Dimension)
    private dimensionRepository: Repository<Dimension>, // Add Dimension repository to handle inventory
  ) {}

  async createPurchaseInvoice(data: any): Promise<PurchaseInvoice> {
    // Step 1: Create and save the purchase invoice
    const purchaseInvoice = this.purchaseInvoiceRepository.create({
      supplierName: data.supplierName,
      purchaseDate: data.purchaseDate,
      totalAmountUSD: data.totalAmountUSD,
    });
    const savedInvoice =
      await this.purchaseInvoiceRepository.save(purchaseInvoice);

    // Step 2: Create and save each purchase item
    const purchaseItems = data.purchaseItems.map((item) => {
      return this.purchaseItemRepository.create({
        ...item,
        purchaseInvoice: savedInvoice,
      });
    });
    await this.purchaseItemRepository.save(purchaseItems);

    // Step 3: Update inventory based on each purchase item
    await Promise.all(
      data.purchaseItems.map(async (item) => {
        const dimension = await this.dimensionRepository.findOne({
          where: { dimensionId: item.dimensionId },
        });

        if (dimension) {
          // Increment the quantity of unopened boxes based on the purchased amount
          dimension.quantityUnopenedBoxes += item.quantity;
          await this.dimensionRepository.save(dimension); // Save updated dimension
        }
      }),
    );

    return savedInvoice;
  }
}
