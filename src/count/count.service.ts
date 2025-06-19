// src/inventory-count/inventory-count.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { CountType } from '../entities/inventory/count.entity';
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
      itemBatchId: itemBatchId,
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
        batch.start = Number(batch.start) + sqm;
        variant.totalStart = Number(variant.totalStart) + sqm;
        break;

      case 'S':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqm;
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqm;
        break;

      case 'G':
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
        break;

      case 'SR':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
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
        'itemVariant.batches',
      ],
      order: { id: 'DESC' },
    });

    return counts.map((cnt) => {
      const v = cnt.itemVariant!;
      const t = v.thickness!;
      const item = t.item!;
      const batches = v.batches || [];

      return {
        // the count’s own ID
        id: cnt.id,

        // ▶︎ newly added fields:
        itemVariantName: item.itemName,
        thickness: Number(t.thickness),

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
        itemBatches: batches.map((b) => ({
          id: b.id,
          condition: b.condition,
          dateReceived: b.dateReceived,
        })),
      };
    });
  }

  async update(
    id: number,
    data: {
      itemBatchId?: number;
      date?: string;
      count?: number;
      unit?: 'box' | 'sheet' | 'sqm';
      countOFR?: number;
      type?: CountType;
      finalCost?: number;
      finalCostOfr?: number;
    },
  ): Promise<InventoryCount> {
    // 1) Load existing count + its transaction
    const countRec = await this.inventoryCountRepo.findOne({
      where: { id },
      relations: ['itemVariant'],
    });
    if (!countRec)
      throw new NotFoundException(`InventoryCount #${id} not found`);

    const txn = await this.inventoryTxnRepo.findOne({
      where: { inventoryCountId: id },
    });
    if (!txn)
      throw new NotFoundException(
        `InventoryTransaction for count #${id} not found`,
      );

    // 2) Load the OLD batch & variant
    const oldBatch = await this.itemBatchRepo.findOne({
      where: { id: txn.itemBatchId },
      relations: ['itemVariant'],
    });
    if (!oldBatch)
      throw new NotFoundException(`ItemBatch #${txn.itemBatchId} not found`);
    const oldVariant = oldBatch.itemVariant;

    // 3) Deduct “old” quantities from oldBatch & oldVariant
    const oldSqm = countRec.sqm;
    const oldSqmOfr = txn.sqmofr;
    switch (countRec.type) {
      case CountType.RVR:
        oldBatch.start = Number(oldBatch.start) - oldSqm;
        oldVariant.totalStart = Number(oldVariant.totalStart) - oldSqm;
        break;
      case CountType.S:
        oldBatch.start = Number(oldBatch.start) - oldSqm;
        oldBatch.startOFR = Number(oldBatch.startOFR) - oldSqmOfr;
        oldVariant.totalStart = Number(oldVariant.totalStart) - oldSqm;
        oldVariant.totalStartOFR = Number(oldVariant.totalStartOFR) - oldSqmOfr;
        break;
      case CountType.G:
        oldBatch.startOFR = Number(oldBatch.startOFR) - oldSqmOfr;
        oldVariant.totalStartOFR = Number(oldVariant.totalStartOFR) - oldSqmOfr;
        break;
      case CountType.SR:
        oldBatch.start = Number(oldBatch.start) - oldSqm;
        oldBatch.startOFR = Number(oldBatch.startOFR) - oldSqmOfr;
        oldVariant.totalStart = Number(oldVariant.totalStart) - oldSqm;
        oldVariant.totalStartOFR = Number(oldVariant.totalStartOFR) - oldSqmOfr;
        break;
    }

    // 4) Decide where to ADD the new quantities
    //    by default it’s the same batch/variant:
    let newBatch = oldBatch;
    let newVariant = oldVariant;

    // If they passed a different batchId, fetch that instead:
    if (data.itemBatchId != null && data.itemBatchId !== oldBatch.id) {
      newBatch = await this.itemBatchRepo.findOne({
        where: { id: data.itemBatchId },
        relations: ['itemVariant'],
      });
      if (!newBatch)
        throw new NotFoundException(`ItemBatch #${data.itemBatchId} not found`);
      newVariant = newBatch.itemVariant;
      countRec.itemVariant = newVariant;
    }

    // 5) Apply the incoming fields to the count record
    countRec.date = data.date ?? countRec.date;
    countRec.count = data.count ?? countRec.count;
    countRec.type = data.type ?? countRec.type;
    countRec.finalCost = data.finalCost ?? countRec.finalCost;
    countRec.finalCostOfr = data.finalCostOfr ?? countRec.finalCostOfr;

    // 6) Recompute SQM & rawSqmOfr
    const unit = data.unit ?? 'sheet';
    const cnt = countRec.count;
    const cntOfr = data.countOFR ?? cnt;
    const oneM2 =
      (Number(newVariant.length) * Number(newVariant.width)) / 10000;

    let rawSqm = 0;
    let rawSqmOfr = 0;
    switch (unit) {
      case 'box':
        rawSqm = oneM2 * newVariant.sheetsPerBox * cnt;
        rawSqmOfr = oneM2 * newVariant.sheetsPerBox * cntOfr;
        break;
      case 'sheet':
        rawSqm = oneM2 * cnt;
        rawSqmOfr = oneM2 * cntOfr;
        break;
      case 'sqm':
        rawSqm = cnt;
        rawSqmOfr = cntOfr;
        break;
    }
    countRec.sqm = Number(rawSqm.toFixed(2));

    // 7) Update the transaction record
    let newSqm = 0;
    let newSqmOfr = 0;
    let qty = 0;
    let qtyOfr = 0;

    switch (countRec.type) {
      case CountType.S:
        newSqm = countRec.sqm;
        newSqmOfr = countRec.sqm;
        qty = cnt;
        qtyOfr = cnt;
        break;
      case CountType.SR:
        newSqm = countRec.sqm;
        newSqmOfr = Number(rawSqmOfr.toFixed(2));
        qty = cnt;
        qtyOfr = cntOfr;
        break;
      case CountType.G:
        newSqm = 0;
        newSqmOfr = countRec.sqm;
        qty = 0;
        qtyOfr = cnt;
        break;
      case CountType.RVR:
        newSqm = countRec.sqm;
        newSqmOfr = 0;
        qty = cnt;
        qtyOfr = 0;
        break;
    }

    txn.sqm = newSqm;
    txn.sqmofr = newSqmOfr;
    txn.quantity = qty;
    txn.quantityofr = qtyOfr;
    txn.finalcost = countRec.finalCost;
    txn.finalcostofr = countRec.finalCostOfr;
    txn.itemVariant = newVariant;
    txn.itemBatchId = newBatch.id;

    // 8) ADD the new quantities back onto newBatch/newVariant
    switch (countRec.type) {
      case CountType.RVR:
        newBatch.start = Number(newBatch.start) + newSqm;
        newVariant.totalStart = Number(newVariant.totalStart) + newSqm;
        break;
      case CountType.S:
        newBatch.start = Number(newBatch.start) + newSqm;
        newBatch.startOFR = Number(newBatch.startOFR) + newSqmOfr;
        newVariant.totalStart = Number(newVariant.totalStart) + newSqm;
        newVariant.totalStartOFR = Number(newVariant.totalStartOFR) + newSqmOfr;
        break;
      case CountType.G:
        newBatch.startOFR = Number(newBatch.startOFR) + newSqmOfr;
        newVariant.totalStartOFR = Number(newVariant.totalStartOFR) + newSqmOfr;
        break;
      case CountType.SR:
        newBatch.start = Number(newBatch.start) + newSqm;
        newBatch.startOFR = Number(newBatch.startOFR) + newSqmOfr;
        newVariant.totalStart = Number(newVariant.totalStart) + newSqm;
        newVariant.totalStartOFR = Number(newVariant.totalStartOFR) + newSqmOfr;
        break;
    }

    // 9) Persist everything
    await this.inventoryCountRepo.save(countRec);
    await this.inventoryTxnRepo.save(txn);
    // we always saved oldBatch above; now save newBatch/variant if they differ
    if (newBatch.id !== oldBatch.id) {
      await this.itemBatchRepo.save(newBatch);
      await this.itemVariantRepo.save(newVariant);
      // also persist the corrected oldBatch/oldVariant
      await this.itemBatchRepo.save(oldBatch);
      await this.itemVariantRepo.save(oldVariant);
    } else {
      // same batch: one save handles both additions/subtractions
      await this.itemBatchRepo.save(newBatch);
      await this.itemVariantRepo.save(newVariant);
    }

    return countRec;
  }

  async createSingleopening(data: any): Promise<InventoryCount> {
    const {
      itemVariantId,
      date,
      count,
      type,
      unit,
      countOFR = 0,
      finalCost = 0,
      finalCostOfr = 0,
    } = data;

    // 1) Check for existing batch for this variant with dateReceived = null
    let batch = await this.itemBatchRepo.findOne({
      where: {
        itemVariant: { id: itemVariantId },
        dateReceived: null,
      },
      relations: ['itemVariant'],
    });

    // 2) If not found, create a new one
    if (!batch) {
      const variant = await this.itemVariantRepo.findOneBy({
        id: itemVariantId,
      });
      if (!variant) {
        throw new NotFoundException(`ItemVariant #${itemVariantId} not found`);
      }

      batch = this.itemBatchRepo.create({
        itemVariant: variant,
        dateReceived: null,
        condition: 'Clean', // or default condition
      });
      await this.itemBatchRepo.save(batch);

      // Attach the full variant for later use
      batch.itemVariant = variant;
    }

    const variant = batch.itemVariant;

    // 3) Compute sqm
    const oneSheetM2 = (Number(variant.length) * Number(variant.width)) / 10000;
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

    // 4) Compute cost
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

    // 5) Save inventory count
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

    // 6) Save inventory transaction
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

    const txn = this.inventoryTxnRepo.create({
      itemVariant: variant,
      itemBatchId: batch.id,
      transactionType: 'Opening Count',
      sqm,
      sqmofr,
      quantity: qty,
      quantityofr: qtyOFR,
      inventoryCountId: savedCount.id,
      finalcost: fc,
      finalcostofr: fco,
    });
    await this.inventoryTxnRepo.save(txn);

    // 7) Update batch and variant totals
    switch (type) {
      case 'RVR':
        batch.start = Number(batch.start) + sqm;
        variant.totalStart = Number(variant.totalStart) + sqm;
        break;
      case 'S':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqm;
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqm;
        break;
      case 'G':
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
        break;
      case 'SR':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
        break;
    }

    await this.itemBatchRepo.save(batch);
    await this.itemVariantRepo.save(variant);

    return savedCount;
  }
}
