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
    const {
      itemVariantId,
      date,
      count,
      type,
      unit,
      countOFR,
      finalCost,
      finalCostOfr,
    } = data;

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
    let txnFinalCostOfr = 0;
    let txnFinalCost = 0;
    if (type === 'S') {
      txnSqm = sqm;
      txnSqmOFR = sqm;
      qty = count;
      qtyOFR = count;
      txnFinalCostOfr = finalCost;
      txnFinalCost = finalCost;
    } else if (type === 'SR') {
      txnSqm = sqm;
      txnSqmOFR = sqmofr;
      qty = count;
      qtyOFR = countOFR;
      txnFinalCostOfr = finalCostOfr;
      txnFinalCost = finalCost;
    } else if (type === 'G') {
      txnSqm = 0;
      txnSqmOFR = sqm;
      qty = 0;
      qtyOFR = count;
      txnFinalCostOfr = finalCostOfr;
      txnFinalCost = finalCost;
    } else if (type === 'RVR') {
      txnSqm = sqm;
      txnSqmOFR = 0;
      qty = count;
      qtyOFR = 0;
      txnFinalCostOfr = finalCostOfr;
      txnFinalCost = finalCost;
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
      finalcost: txnFinalCost,
      finalcostofr: txnFinalCostOfr,
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

  async remove(id: number): Promise<void> {
    await this.inventoryCountRepo.delete(id);
  }

  async getFilteredCounts(): Promise<any[]> {
    const counts = await this.inventoryCountRepo.find({
      relations: [
        'itemVariant',
        'itemVariant.thickness',
        'itemVariant.thickness.item',
      ],
      order: { date: 'DESC' },
    });

    return counts.map((cnt) => {
      const v = cnt.itemVariant!;
      const t = v.thickness!;
      const item = t.item!;

      return {
        // the count’s own ID
        id: cnt.id,

        // ▶︎ newly added fields:
        itemVariantName: item.itemName, // ← the “name” of the item
        thickness: Number(t.thickness), // ← the glass thickness

        // variant dimensions & meta
        length: Number(v.length),
        width: Number(v.width),
        sheetsPerBox: v.sheetsPerBox,
        origin: v.origin,
        itemVariantType: item.type,

        // count details
        date: cnt.date,
        count: cnt.count,
        sqm: Number(cnt.sqm),
        type: cnt.type,
        finalCost: Number(cnt.finalCost),
        finalCostOfr: Number(cnt.finalCostOfr),
      };
    });
  }

  async update(
    id: number,
    data: any, // { itemVariantId?, date?, count?, type?, unit?, countOFR?, finalCost?, finalCostOfr? }
  ): Promise<InventoryCount> {
    // 1) load existing count
    const countRec = await this.inventoryCountRepo.findOne({
      where: { id },
      relations: ['itemVariant'],
    });
    if (!countRec) {
      throw new NotFoundException(`InventoryCount #${id} not found`);
    }

    // 2) if they’re changing the variant, re-fetch it
    let variant = countRec.itemVariant;
    if (data.itemVariantId && data.itemVariantId !== variant.id) {
      variant = await this.itemVariantRepo.findOne({
        where: { id: data.itemVariantId },
      });
      if (!variant) {
        throw new NotFoundException(
          `ItemVariant #${data.itemVariantId} not found`,
        );
      }
      countRec.itemVariant = variant;
    }

    // 3) apply new fields (date, count, type, finalCost, finalCostOfr)
    countRec.date = data.date ?? countRec.date;
    countRec.count = data.count ?? countRec.count;
    countRec.type = data.type ?? countRec.type;
    countRec.finalCost = data.finalCost ?? countRec.finalCost;
    countRec.finalCostOfr = data.finalCostOfr ?? countRec.finalCostOfr;

    // 4) recompute sqm and sqmofr based on unit + countOFR
    const unit = data.unit ?? 'sheet'; // default or pass-through
    const cntOfR = data.countOFR ?? 0;
    const cnt = countRec.count;

    const lengthCm = Number(variant.length);
    const widthCm = Number(variant.width);
    const oneSheetM2 = (lengthCm * widthCm) / 10000;

    let rawSqm = 0;
    let rawSqmofr = 0;
    switch (unit) {
      case 'box':
        rawSqm = oneSheetM2 * variant.sheetsPerBox * cnt;
        rawSqmofr = oneSheetM2 * variant.sheetsPerBox * cntOfR;
        break;
      case 'sheet':
        rawSqm = oneSheetM2 * cnt;
        rawSqmofr = oneSheetM2 * cntOfR;
        break;
      case 'sqm':
        rawSqm = cnt;
        rawSqmofr = cntOfR;
        break;
    }
    countRec.sqm = Number(rawSqm.toFixed(2));
    // note: InventoryCount only stores `sqm`. We keep sqmofr in the transaction.

    // 5) save the updated count
    const savedCount = await this.inventoryCountRepo.save(countRec);

    // 6) find its transaction record
    const txn = await this.inventoryTxnRepo.findOne({
      where: { inventoryCountId: savedCount.id },
    });
    if (!txn) {
      // if no transaction existed (unlikely), you could create one;
      throw new NotFoundException(
        `InventoryTransaction for count #${savedCount.id} not found`,
      );
    }

    // 7) recompute the transaction fields (sqm, sqmofr, quantity, quantityofr)
    let txnSqm = 0,
      txnSqmOFR = 0,
      qty = 0,
      qtyOFR = 0;
    let txnFinalCostOfr = 0;
    let txnFinalCost = 0;

    if (countRec.type === 'S') {
      txnSqm = countRec.sqm;
      txnSqmOFR = countRec.sqm;
      qty = cnt;
      qtyOFR = cnt;
      txnFinalCostOfr = countRec.finalCost;
      txnFinalCost = countRec.finalCost;
    } else if (countRec.type === 'SR') {
      txnSqm = countRec.sqm;
      txnSqmOFR = Number(rawSqmofr.toFixed(2));
      qty = cnt;
      qtyOFR = cntOfR;
      txnFinalCostOfr = countRec.finalCostOfr;
      txnFinalCost = countRec.finalCost;
    } else if (countRec.type === 'G') {
      txnSqm = 0;
      txnSqmOFR = countRec.sqm;
      qty = 0;
      qtyOFR = cnt;
      txnFinalCostOfr = countRec.finalCostOfr;
      txnFinalCost = countRec.finalCost;
    } else if (countRec.type === 'RVR') {
      txnSqm = countRec.sqm;
      txnSqmOFR = 0;
      qty = cnt;
      qtyOFR = 0;
      txnFinalCostOfr = countRec.finalCostOfr;
      txnFinalCost = countRec.finalCost;
    }

    txn.sqm = txnSqm;
    txn.sqmofr = txnSqmOFR;
    txn.quantity = qty;
    txn.quantityofr = qtyOFR;
    // also update finalcost fields on txn to match count
    txn.finalcost = savedCount.finalCost;
    txn.finalcostofr = savedCount.finalCostOfr;
    txn.itemVariant = variant;
    txn.itemVariantId = variant.id;

    // 8) save transaction
    await this.inventoryTxnRepo.save(txn);

    return savedCount;
  }
}
