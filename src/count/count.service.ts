// src/inventory-count/inventory-count.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';

@Injectable()
export class InventoryCountService {
  constructor(
    @InjectRepository(InventoryCount)
    private readonly inventoryCountRepo: Repository<InventoryCount>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepo: Repository<ItemVariant>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTxnRepo: Repository<InventoryTransaction>,
  ) {}

  /** Accepts single or array of count-rows */
  async create(
    createData: any | any[],
  ): Promise<InventoryCount | InventoryCount[]> {
    if (Array.isArray(createData)) {
      const results: InventoryCount[] = [];
      for (const row of createData) {
        results.push(await this.createSingle(row));
      }
      return results;
    }
    return this.createSingle(createData);
  }

  /** internal helper: save the count AND its inventory transaction */
  private async createSingle(data: any): Promise<InventoryCount> {
    const { itemVariantId, date, count, type, unit,countOFR ,finalCost,finalCostOfr } = data;

    // fetch variant
    const variant = await this.itemVariantRepo.findOne({
      where: { id: itemVariantId },
    });
    if (!variant) {
      throw new NotFoundException(`ItemVariant #${itemVariantId} not found`);
    }

    // compute one sheet area (cm→m²)
    const lengthCm = Number(variant.length);
    const widthCm = Number(variant.width);
    const oneSheetM2 = (lengthCm * widthCm) / 10000;

    // compute total sqm of this count
    let rawSqm: number;
    let rawSqmofr: number;
    switch (unit) {
      case 'box':
        rawSqm = oneSheetM2 * variant.sheetsPerBox * count;
        rawSqmofr = oneSheetM2 * variant.sheetsPerBox * countOFR;
        break;
      case 'sheet':
        rawSqm = oneSheetM2 * count;
        rawSqmofr = oneSheetM2 * countOFR;
        break;
      case 'sqm':
        rawSqm = count;
        rawSqmofr = countOFR;
        break;
      default:
        rawSqm = 0;
    }
    // round to 2 decimals
    const sqm = Number(rawSqm.toFixed(2));
    const sqmofr = Number(rawSqmofr.toFixed(2));

    // save the InventoryCount
    const inventoryCount = this.inventoryCountRepo.create({
      itemVariant: variant,
      date,
      count,
      type,
      sqm,
      finalCost,
      finalCostOfr,
    });
    const savedCount = await this.inventoryCountRepo.save(inventoryCount);

    // now compute transaction fields
    let txnSqm = 0;
    let txnSqmOFR = 0;
    let qty = 0;
    let qtyOFR = 0;

    if (type === 'S') {
      txnSqm = sqm;
      txnSqmOFR = sqm;
      qty = count;
      qtyOFR = count;
    } else if (type === 'SR'){
        txnSqm = sqm;
        txnSqmOFR = sqmofr;
        qty = count;
        qtyOFR = countOFR;
    }else if (type === 'G') {
      txnSqm = 0;
      txnSqmOFR = sqm;
      qty = 0;
      qtyOFR = count;
    } else if (type === 'RVR') {
      txnSqm = sqm;
      txnSqmOFR = 0;
      qty = count;
      qtyOFR = 0;
    }

    // create and save the InventoryTransaction
    const txn = this.inventoryTxnRepo.create({
      itemVariant: variant,
      transactionType: 'Count',
      sqm: txnSqm,
      sqmofr: txnSqmOFR,
      quantity: qty,
      quantityofr: qtyOFR,
      inventoryCountId: savedCount.id,
      finalcost:finalCost,
      finalcostofr:finalCostOfr
      // other fields (finalcost, invoiceItemId, etc.) left as null/default
    });
    await this.inventoryTxnRepo.save(txn);

    return savedCount;
  }

  findAll(): Promise<InventoryCount[]> {
    return this.inventoryCountRepo.find({ relations: ['itemVariant'] });
  }

  async findOne(id: number): Promise<InventoryCount> {
    const rec = await this.inventoryCountRepo.findOne({
      where: { id },
      relations: ['itemVariant'],
    });
    if (!rec) {
      throw new NotFoundException(`InventoryCount #${id} not found`);
    }
    return rec;
  }

  async update(id: number, updateData: any): Promise<InventoryCount> {
    const rec = await this.findOne(id);

    if (updateData.itemVariantId) {
      const variant = await this.itemVariantRepo.findOne({
        where: { id: updateData.itemVariantId },
      });
      if (!variant) {
        throw new NotFoundException(
          `ItemVariant #${updateData.itemVariantId} not found`,
        );
      }
      rec.itemVariant = variant;
    }

    Object.assign(rec, updateData);
    return this.inventoryCountRepo.save(rec);
  }

  async remove(id: number): Promise<void> {
    await this.inventoryCountRepo.delete(id);
  }
}
