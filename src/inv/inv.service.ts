import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dimension } from '../entities/inventory/dimension.entity';
import { AdjustedBox } from '../entities/inventory/adjustedBox.entity';
import { OpenedSheet } from '../entities/inventory/openedSheet.entity';
import { InventoryTracking } from '../entities/inventory/inventoryTracking.entity';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Dimension)
    private dimensionRepository: Repository<Dimension>,

    @InjectRepository(AdjustedBox)
    private adjustedBoxRepository: Repository<AdjustedBox>,

    @InjectRepository(OpenedSheet)
    private openedSheetRepository: Repository<OpenedSheet>,

    @InjectRepository(InventoryTracking)
    private inventoryTrackingRepository: Repository<InventoryTracking>,
  ) {}

  async createDimension(dimensionData: Partial<Dimension>): Promise<Dimension> {
    const newDimension = this.dimensionRepository.create(dimensionData);
    return this.dimensionRepository.save(newDimension);
  }

  async adjustBox(adjustmentData: Partial<AdjustedBox>): Promise<AdjustedBox> {
    const adjustedBox = this.adjustedBoxRepository.create(adjustmentData);
    return this.adjustedBoxRepository.save(adjustedBox);
  }

  async openSheet(openedSheetData: Partial<OpenedSheet>): Promise<OpenedSheet> {
    const openedSheet = this.openedSheetRepository.create(openedSheetData);
    return this.openedSheetRepository.save(openedSheet);
  }

  async trackInventory(transactionData: Partial<InventoryTracking>): Promise<InventoryTracking> {
    const trackingRecord = this.inventoryTrackingRepository.create(transactionData);
    return this.inventoryTrackingRepository.save(trackingRecord);
  }

  // Additional methods for retrieving and updating items as needed...
}
