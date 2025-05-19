import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { InventoryTransactionService } from './inventroy-transactions.service';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';

@Controller('inventory-transactions')
export class InventoryTransactionController {
  constructor(
    private readonly inventoryTransactionService: InventoryTransactionService,
  ) {}

  /**
   * Create a new inventory transaction.
   */
  @Post()
  async createTransaction(
    @Body()
    body: {
      itemVariantId: number;
      transactionType: 'purchase' | 'sale';
      sqm: number;
    },
  ): Promise<InventoryTransaction> {
    return this.inventoryTransactionService.createTransaction(
      body.itemVariantId,
      body.transactionType,
      body.sqm,
    );
  }

  /**
   * Get all inventory transactions.
   */
  @Get()
  async getAllTransactions(): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionService.getAllTransactions();
  }

  @Get('activity')
  async getActivity() {
    return this.inventoryTransactionService.getActivity();
  }

  /**
   * Get transactions for a specific item.
   */
  @Get(':itemVariantId')
  async getTransactionsByItem(
    @Param('itemVariantId') itemVariantId: number,
  ): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionService.getTransactionsByItem(
      itemVariantId,
    );
  }
}
