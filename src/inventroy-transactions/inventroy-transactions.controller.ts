import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Header,
  Delete,
  ParseIntPipe,
  UseGuards,
} from "@nestjs/common";
import { InventoryTransactionService } from "./inventroy-transactions.service";
import { InventoryTransaction } from "../entities/inventory/inventoryTransactions.entity";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("inventory-transactions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryTransactionController {
  constructor(
    private readonly inventoryTransactionService: InventoryTransactionService
  ) {}

  /**
   * Create a new inventory transaction.
   */
  @Post()
  @RequirePerms("inventoryTx.create")
  async createTransaction(
    @Body()
    body: {
      itemVariantId: number;
      transactionType: "purchase" | "sale";
      sqm: number;
    }
  ): Promise<InventoryTransaction> {
    return this.inventoryTransactionService.createTransaction(
      body.itemVariantId,
      body.transactionType,
      body.sqm
    );
  }

  /**
   * Get all inventory transactions.
   */
  @Get()
  @RequirePerms("inventoryTx.view")
  async getAllTransactions(): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionService.getAllTransactions();
  }

  @Get("activity")
  @RequirePerms("inventoryTx.view")
  async getActivity(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    // Previously ignored these, so "Load more" on the unfiltered list kept
    // returning page 1 again.
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const size = Math.min(500, Math.max(1, parseInt(pageSize ?? '50', 10) || 50));
    return this.inventoryTransactionService.getActivity(p, size);
  }

  @Get("activity/v1/filtered")
  @RequirePerms("inventoryTx.view")
  @Header("X-BUILD", "SERVER-DEV-123") // change this string every deploy
  async getFilteredActivity(@Query() query: any) {
    return this.inventoryTransactionService.getFilteredActivity(query);
  }

  /**
   * Get transactions for a specific item.
   */
  @Get(":itemVariantId")
  @RequirePerms("inventoryTx.view")
  async getTransactionsByItem(
    @Param("itemVariantId") itemVariantId: number
  ): Promise<InventoryTransaction[]> {
    return this.inventoryTransactionService.getTransactionsByItem(itemVariantId);
  }

  @Delete(":id")
  @RequirePerms("inventoryTx.delete")
  async deleteOne(@Param("id", ParseIntPipe) id: number) {
    return this.inventoryTransactionService.deleteTransactionOnly(id);
  }
}
