import { Controller, Post, Body, Get } from '@nestjs/common';
import { InventoryService } from './inv.service';
import { Dimension } from '../entities/inventory/dimension.entity';
import { AdjustedBox } from '../entities/inventory/adjustedBox.entity';
import { OpenedSheet } from '../entities/inventory/openedSheet.entity';
import { InventoryTracking } from '../entities/inventory/inventoryTracking.entity';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('create-dimension')
  async createDimension(
    @Body() dimensionData: Partial<Dimension>,
  ): Promise<Dimension> {
    return this.inventoryService.createDimension(dimensionData);
  }

  @Post('adjust-box')
  async adjustBox(
    @Body() adjustmentData: Partial<AdjustedBox>,
  ): Promise<AdjustedBox> {
    return this.inventoryService.adjustBox(adjustmentData);
  }

  @Post('open-sheet')
  async openSheet(
    @Body() openedSheetData: Partial<OpenedSheet>,
  ): Promise<OpenedSheet> {
    return this.inventoryService.openSheet(openedSheetData);
  }

  @Post('track-inventory')
  async trackInventory(
    @Body() transactionData: Partial<InventoryTracking>,
  ): Promise<InventoryTracking> {
    return this.inventoryService.trackInventory(transactionData);
  }

  // Additional endpoints for retrieving inventory data as needed...
}
