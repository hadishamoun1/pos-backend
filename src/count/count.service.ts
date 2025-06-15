// src/inventory-count/inventory-count.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';

@Injectable()
export class InventoryCountService {
  constructor(
    @InjectRepository(InventoryCount)
    private readonly inventoryCountRepo: Repository<InventoryCount>,

    @InjectRepository(ItemVariant)
    private readonly itemVariantRepo: Repository<ItemVariant>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTxnRepo: Repository<InventoryTransaction>,

    @InjectRepository(ItemBatch)
    private readonly itemBatchRepo: Repository<ItemBatch>,
  ) {}

  /** Accepts single or array of count-rows */
  async createSingle(data: any): Promise<InventoryCount> {
    const {
      itemBatchId,
      date,
      count,
      type,
      unit,
      countOFR = 0,
      finalCost = 0,
      finalCostOfr = 0,
    } = data;

    // 1) fetch the batch (and variant)
    const batch = await this.itemBatchRepo.findOne({
      where: { id: itemBatchId },
      relations: ['itemVariant'],
    });
    if (!batch) {
      throw new NotFoundException(`ItemBatch #${itemBatchId} not found`);
    }
    const variant = batch.itemVariant;

    // 2) compute one‐sheet area (cm² → m²)
    const oneSheetM2 = (Number(variant.length) * Number(variant.width)) / 10000;

    // 3) figure out sqm & sqmofr
    let rawSqm: number, rawSqmofr: number;
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
        rawSqm = rawSqmofr = 0;
    }
    const sqm = Number(rawSqm.toFixed(2));
    const sqmofr = Number(rawSqmofr.toFixed(2));

    // 4) compute finalCost fields
    let fc = 0,
      fco = 0;
    if (type === 'S') {
      fc = finalCost;
      fco = finalCost;
    } else if (type === 'G') {
      fco = finalCostOfr;
    } else if (type === 'RVR') {
      fc = finalCost;
    } else if (type === 'SR') {
      fc = finalCost;
      fco = finalCostOfr;
    }

    // 5) save the InventoryCount
    const inventoryCount = this.inventoryCountRepo.create({
      itemVariant: variant,
      date,
      count,
      type,
      sqm,
      finalCost: fc,
      finalCostOfr: fco,
    });
    const savedCount = await this.inventoryCountRepo.save(inventoryCount);

    // 6) derive txn quantities
    let qty = 0,
      qtyOFR = 0;
    if (type === 'S') {
      qty = count;
      qtyOFR = count;
    } else if (type === 'SR') {
      qty = count;
      qtyOFR = countOFR;
    } else if (type === 'G') {
      qtyOFR = count;
    } else if (type === 'RVR') {
      qty = count;
    }

    // 7) save the InventoryTransaction
    const txn = this.inventoryTxnRepo.create({
      itemVariant: variant,
      transactionType: 'Count',
      sqm,
      sqmofr,
      quantity: qty,
      quantityofr: qtyOFR,
      inventoryCountId: savedCount.id,
      finalcost: fc,
      finalcostofr: fco,
    });
    await this.inventoryTxnRepo.save(txn);

    // 8) **update batch & variant totals** per your rules
    switch (type) {
      case 'RVR':
        batch.start += sqm;
        variant.totalStart += sqm;
        break;
      case 'S':
        batch.start += sqm;
        batch.startOFR += sqmofr;
        variant.totalStart += sqm;
        variant.totalStartOFR += sqmofr;
        break;
      case 'G':
        batch.startOFR += sqmofr;
        variant.totalStartOFR += sqmofr;
        break;
      case 'SR':
        batch.start += sqm;
        batch.startOFR += sqmofr;
        variant.totalStart += sqm;
        variant.totalStartOFR += sqmofr;
        break;
    }
    await this.itemBatchRepo.save(batch);
    await this.itemVariantRepo.save(variant);

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

    if (countRec.type === 'S') {
      countRec.finalCostOfr = countRec.finalCost;
    }

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
