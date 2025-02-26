import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Injectable()
export class InventoryTransactionService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepository: Repository<ItemVariant>,
  ) {}

  /**
   * Create a new inventory transaction and update item stock.
   */
  async createTransaction(
    itemVariantId: number,
    transactionType: 'purchase' | 'sale',
    sqm: number,
  ): Promise<InventoryTransaction> {
    // Validate the item variant
    const itemVariant = await this.itemVariantRepository.findOne({ where: { id: itemVariantId } });
    if (!itemVariant) {
      throw new NotFoundException(`ItemVariant with ID ${itemVariantId} not found.`);
    }

    // Create the inventory transaction
    const transaction = this.inventoryTransactionRepository.create({
      itemVariant,
      transactionType,
      sqm,
    });

    await this.inventoryTransactionRepository.save(transaction);

    // Update inventory stock
    if (transactionType === 'purchase') {
      await this.itemVariantRepository.increment({ id: itemVariantId }, 'in', sqm);
      await this.itemVariantRepository.increment({ id: itemVariantId }, 'balance', sqm);
    } else if (transactionType === 'sale') {
      await this.itemVariantRepository.increment({ id: itemVariantId }, 'out', sqm);
      await this.itemVariantRepository.decrement({ id: itemVariantId }, 'balance', sqm);
    }

    return transaction;
  }

  /**
   * Get all inventory transactions.
   */
  async getAllTransactions(): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionRepository.find({ relations: ['itemVariant'] });
  }

  /**
   * Get inventory transactions for a specific item.
   */
  async getTransactionsByItem(itemVariantId: number): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionRepository.find({
      where: { itemVariant: { id: itemVariantId } },
      relations: ['itemVariant'],
    });
  }
}
