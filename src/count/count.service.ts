// src/inventory-count/inventory-count.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        break;

      case 'S':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqm;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqm;

        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;

      case 'G':
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;

        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);

        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;

      case 'SR':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);
        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
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

  // Add this new method in your `InventoryCountService`

  async getFilteredCountsWithBatchBalance(): Promise<any[]> {
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
        id: cnt.id,
        itemVariantName: item.itemName,
        thickness: Number(t.thickness),
        length: Number(v.length),
        width: Number(v.width),
        sheetsPerBox: v.sheetsPerBox,
        origin: v.origin,
        itemVariantType: item.type,
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
          start: b.start,
          startOFR: b.startOFR,
          balance: b.balance,
          balanceOFR: b.balanceOFR,
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

    const oldBatch = await this.itemBatchRepo.findOne({
      where: { id: txn.itemBatchId },
      relations: ['itemVariant'],
    });
    if (!oldBatch)
      throw new NotFoundException(`ItemBatch #${txn.itemBatchId} not found`);
    const oldVariant = oldBatch.itemVariant;

    const oldSqm = countRec.sqm;
    const oldSqmOfr = txn.sqmofr;
    const originalType = countRec.type;

    // ROLLBACK
    switch (originalType) {
      case CountType.RVR:
        oldBatch.start -= oldSqm;
        oldVariant.totalStart -= oldSqm;
        break;
      case CountType.S:
        oldBatch.start -= oldSqm;
        oldBatch.startOFR = oldBatch.start;
        oldVariant.totalStart -= oldSqm;
        oldVariant.totalStartOFR = oldVariant.totalStart;
        break;
      case CountType.G:
        oldBatch.startOFR -= oldSqmOfr;
        oldVariant.totalStartOFR -= oldSqmOfr;
        break;
      case CountType.SR:
        oldBatch.start -= oldSqm;
        oldBatch.startOFR -= oldSqmOfr;
        oldVariant.totalStart -= oldSqm;
        oldVariant.totalStartOFR -= oldSqmOfr;
        break;
    }

    let newBatch = oldBatch;
    let newVariant = oldVariant;
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

    countRec.date = data.date ?? countRec.date;
    countRec.count = data.count ?? countRec.count;
    countRec.type = data.type ?? countRec.type;
    countRec.finalCost = data.finalCost ?? countRec.finalCost;
    countRec.finalCostOfr = data.finalCostOfr ?? countRec.finalCostOfr;

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

    let newSqm = 0;
    let newSqmOfr = 0;
    let qty = 0;
    let qtyOfr = 0;

    switch (countRec.type) {
      case CountType.S:
        newSqm = countRec.sqm;
        newSqmOfr = newSqm;
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

    // APPLY NEW VALUES
    switch (countRec.type) {
      case CountType.RVR:
        newBatch.start += newSqm;
        newVariant.totalStart += newSqm;
        break;
      case CountType.S:
        newBatch.start += newSqm;
        newBatch.startOFR = newBatch.start;
        newVariant.totalStart += newSqm;
        newVariant.totalStartOFR = newVariant.totalStart;
        break;
      case CountType.G:
        newBatch.startOFR += newSqmOfr;
        newVariant.totalStartOFR += newSqmOfr;
        break;
      case CountType.SR:
        newBatch.start += newSqm;
        newBatch.startOFR += newSqmOfr;
        newVariant.totalStart += newSqm;
        newVariant.totalStartOFR += newSqmOfr;
        break;
    }

    // BALANCE UPDATES
    newBatch.balance =
      Number(newBatch.start || 0) +
      Number(newBatch.in || 0) -
      Number(newBatch.out || 0);
    newBatch.balanceOFR = newBatch.startOFR ?? newBatch.balance;

    newVariant.totalBalance =
      Number(newVariant.totalStart || 0) +
      Number(newVariant.totalIn || 0) -
      Number(newVariant.totalOut || 0);
    newVariant.totalBalanceOFR =
      newVariant.totalStartOFR ?? newVariant.totalBalance;

    await this.inventoryCountRepo.save(countRec);
    await this.inventoryTxnRepo.save(txn);

    if (newBatch.id !== oldBatch.id) {
      oldBatch.balance =
        Number(oldBatch.start || 0) +
        Number(oldBatch.in || 0) -
        Number(oldBatch.out || 0);
      oldBatch.balanceOFR = oldBatch.startOFR ?? oldBatch.balance;

      oldVariant.totalBalance =
        Number(oldVariant.totalStart || 0) +
        Number(oldVariant.totalIn || 0) -
        Number(oldVariant.totalOut || 0);
      oldVariant.totalBalanceOFR =
        oldVariant.totalStartOFR ?? oldVariant.totalBalance;

      await this.itemBatchRepo.save(newBatch);
      await this.itemVariantRepo.save(newVariant);
      await this.itemBatchRepo.save(oldBatch);
      await this.itemVariantRepo.save(oldVariant);
    } else {
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
      dateReceived: rawDateReceived = null, // 👈 new raw input
      condition = 'Clean', // 👈 default value
    } = data;

    // ✅ Format the dateReceived to MM/YYYY
    const formatDateReceived = (value: string | null): string | null => {
      if (!value) return null;
      const [month, year] = value.split('/');
      if (!month || !year) return null;
      return `${month.padStart(2, '0')}/${year}`;
    };

    const formattedDateReceived = formatDateReceived(rawDateReceived);

    // ✅ Step 1: Try to find existing batch
    let batch = await this.itemBatchRepo.findOne({
      where: {
        itemVariant: { id: itemVariantId },
        dateReceived: formattedDateReceived ? formattedDateReceived : IsNull(),
      },
      relations: ['itemVariant'],
    });

    console.log(
      '✅ Batch search result:',
      batch?.id,
      'dateReceived:',
      batch?.dateReceived,
    );

    // ✅ Step 2: If no such batch, create one
    if (!batch) {
      const variant = await this.itemVariantRepo.findOneBy({
        id: itemVariantId,
      });
      if (!variant)
        throw new NotFoundException(`ItemVariant #${itemVariantId} not found`);

      batch = this.itemBatchRepo.create({
        itemVariant: variant,
        dateReceived: formattedDateReceived || null,
        condition: condition || 'Clean',
      });
      await this.itemBatchRepo.save(batch);

      // Attach variant manually
      batch.itemVariant = variant;
    }

    const variant = batch.itemVariant;

    // ✅ Step 3: Compute sqm
    const oneSheetM2 = (Number(variant.length) * Number(variant.width)) / 10000;
    let rawSqm = 0;
    let rawSqmofr = 0;

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
    }

    const sqm = Number(rawSqm.toFixed(2));
    const sqmofr = Number(rawSqmofr.toFixed(2));

    // ✅ Step 4: Compute cost
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

    // ✅ Step 5: Save inventory count
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

    // ✅ Step 6: Save inventory transaction
    let qty = 0,
      qtyOFR = 0;
    if (type === 'S' || type === 'SR') qty = count;
    if (type === 'G' || type === 'SR') qtyOFR = countOFR || count;

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

    // ✅ Step 7: Update batch and variant totals
    switch (type) {
      case 'RVR':
        batch.start = Number(batch.start) + sqm;
        variant.totalStart = Number(variant.totalStart) + sqm;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        break;

      case 'S':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqm;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqm;

        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;

      case 'G':
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;

        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);

        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;

      case 'SR':
        batch.start = Number(batch.start) + sqm;
        batch.startOFR = Number(batch.startOFR) + sqmofr;
        variant.totalStart = Number(variant.totalStart) + sqm;
        variant.totalStartOFR = Number(variant.totalStartOFR) + sqmofr;
        batch.balance =
          Number(batch.start || 0) +
          Number(batch.in || 0) -
          Number(batch.out || 0);
        batch.balanceOFR =
          Number(batch.startOFR || 0) +
          Number(batch.inOFR || 0) -
          Number(batch.outOFR || 0);
        variant.totalBalance =
          Number(variant.totalStart || 0) +
          Number(variant.totalIn || 0) -
          Number(variant.totalOut || 0);
        variant.totalBalanceOFR =
          Number(variant.totalStartOFR || 0) +
          Number(variant.totalInOFR || 0) -
          Number(variant.totalOutOFR || 0);
        break;
    }

    await this.itemBatchRepo.save(batch);
    await this.itemVariantRepo.save(variant);

    return savedCount;
  }
}
