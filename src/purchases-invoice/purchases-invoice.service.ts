import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';
import { PurchaseItem } from '../entities/purchaseItem.entity';
import { Dimension } from '../entities/inventory/dimension.entity';
import { Supplier } from '../entities/suppliers.entity';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private purchaseInvoiceRepository: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseItem)
    private purchaseItemRepository: Repository<PurchaseItem>,
    @InjectRepository(Dimension)
    private dimensionRepository: Repository<Dimension>, // Add Dimension repository to handle inventory
    @InjectRepository(Supplier)
    private supplierRepository: Repository<Supplier>, // Inject Supplier repository
  ) {}

  async createPurchaseInvoice(data: any): Promise<PurchaseInvoice> {
    // Step 1: Find the supplier by name or ID
    const supplier = await this.supplierRepository.findOne({
      where: { id: data.supplierId },
    });

    if (!supplier) {
      throw new Error('Supplier not found');
    }

    // Step 2: Create and save the purchase invoice with supplier reference
    const purchaseInvoice = this.purchaseInvoiceRepository.create({
      supplier,
      purchaseDate: data.purchaseDate,
      totalAmountUSD: data.totalAmountUSD,
    });
    const savedInvoice = await this.purchaseInvoiceRepository.save(purchaseInvoice);

    // Step 3: Create and save each purchase item with associated invoice
    const purchaseItems = data.purchaseItems.map((item) => {
      return this.purchaseItemRepository.create({
        ...item,
        purchaseInvoice: savedInvoice,
      });
    });
    await this.purchaseItemRepository.save(purchaseItems);

    // Step 4: Update inventory based on each purchase item
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
