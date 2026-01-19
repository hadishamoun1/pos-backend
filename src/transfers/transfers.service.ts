// src/transfers/transfers.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import type { DeepPartial } from 'typeorm';

import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { Settings } from '../entities/settings.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { InvoiceItem } from 'src/entities/invoiceItem.entity';
import { InventoryCount } from 'src/entities/inventory/count.entity';
import { PurchaseInvoiceItem } from 'src/entities/Purchase-Invoice/purchase-invoice-item.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';

import { InventoryTransactionGateway } from '../inventroy-transactions/inventory-transaction.gateway';
import { InventoryTransactionService } from '../inventroy-transactions/inventroy-transactions.service';

type CostBundle = {
  ofr: number; // ItemVariant.averageCost  (OFR)
  vm: number;  // ItemVariant.averageCostVM
  c: number;   // ItemNameDescription.averageCostC
  cvm: number; // ItemNameDescription.averageCostCVM
};

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transfersRepo: Repository<Transfer>,

    @InjectRepository(TransferItem)
    private readonly itemsRepo: Repository<TransferItem>,

    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTxRepo: Repository<InventoryTransaction>,

    @InjectRepository(Thickness)
    private readonly thicknessRepo: Repository<Thickness>,

    @InjectRepository(ItemVariant)
    private readonly variantRepo: Repository<ItemVariant>,

    @InjectRepository(ItemBatch)
    private readonly itemBatchRepo: Repository<ItemBatch>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepo: Repository<InvoiceItem>,

    @InjectRepository(InventoryCount)
    private readonly countRepo: Repository<InventoryCount>,

    @InjectRepository(PurchaseInvoiceItem)
    private readonly purchaseItemRepo: Repository<PurchaseInvoiceItem>,

    @InjectRepository(ItemNameDescription)
    private readonly descRepo: Repository<ItemNameDescription>,

    private readonly inventoryTransactionService: InventoryTransactionService,
    private readonly inventoryTransactionGateway: InventoryTransactionGateway,
  ) {}

  // -----------------------------
  // Utilities
  // -----------------------------
  private num(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private maybeNum(v: any): number | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private logIfNaN(obj: any, context: string) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number' && isNaN(value)) {
        console.error(`❌ NaN detected in ${context}.${key}`, obj);
      }
    }
  }

  private async emitActivityNowAndSoon() {
    const updated = await this.inventoryTransactionService.getActivity();
    this.inventoryTransactionGateway.sendActivityUpdate(updated);

    setTimeout(async () => {
      const updated2 = await this.inventoryTransactionService.getActivity();
      this.inventoryTransactionGateway.sendActivityUpdate(updated2);
    }, 100);
  }

  private async mustGetTransfer(
    manager: EntityManager,
    id: number,
  ): Promise<Transfer> {
    const t = await manager.getRepository(Transfer).findOne({
      where: { id },
      relations: ['items', 'items.itemBatch', 'items.itemBatch.itemVariant'],
    });
    if (!t) throw new NotFoundException(`Transfer ${id} not found`);
    return t;
  }

  private getPrefixFromLocation(location: string): string {
    switch (location) {
      case 'Adjustment +':
      case 'Adjustment -':
        return 'ADJ';
      case 'Breakage':
        return 'BR';
      case 'Defects':
        return 'DEF';
      default:
        return 'TR';
    }
  }

  private async getActiveYearSuffix(manager: EntityManager): Promise<string> {
    const setting = await manager.getRepository(Settings).findOne({
      where: { isActive: true },
    });
    if (!setting) throw new NotFoundException('No active year found in Settings');
    return setting.year.slice(-2);
  }

  private async nextTransferNumber(
    manager: EntityManager,
    prefix: string,
    year2: string,
  ): Promise<string> {
    const last = await manager
      .getRepository(Transfer)
      .createQueryBuilder('t')
      .where('t.transferNumber LIKE :pattern', { pattern: `${prefix}${year2}-%` })
      .orderBy('t.id', 'DESC')
      .getOne();

    const next = last
      ? parseInt(String((last as any).transferNumber).split('-')[1], 10) + 1
      : 1;

    return `${prefix}${year2}-${String(next).padStart(2, '0')}`;
  }

  /** Weighted avg for OFR ONLY (keep your existing averageCost math). */
  private computeNewAvgCost(
    prevQty: number,
    prevCost: number,
    inQty: number,
    inCost: number,
  ) {
    const pq = Number(prevQty) || 0;
    const pc = Number(prevCost) || 0;
    const iq = Number(inQty) || 0;
    const ic = Number(inCost) || 0;

    const total = pq + iq;
    if (total <= 0) return pc;
    return (pq * pc + iq * ic) / total;
  }

  // -----------------------------
  // Purchase cost pickers
  // -----------------------------
  private pickPurchaseOfr(pi: any): number | null {
    const raw =
      pi?.averageCostOfr ??
      pi?.averageCost ??
      pi?.finalCostOfr ??
      pi?.costOfr ??
      pi?.price ??
      null;

    return this.maybeNum(raw);
  }

  private pickPurchaseVm(pi: any): number | null {
    const raw =
      pi?.averageCostVm ??
      pi?.averageCostVM ??
      pi?.finalCostVm ??
      pi?.finalCostVM ??
      pi?.finalCost ??
      pi?.costVm ??
      pi?.costVM ??
      null;

    return this.maybeNum(raw);
  }

  private pickPurchaseC(pi: any): number | null {
    const raw =
      pi?.averageCostC ??
      pi?.finalCostC ??
      pi?.costC ??
      null;

    return this.maybeNum(raw);
  }

  private pickPurchaseCvm(pi: any): number | null {
    const raw =
      pi?.averageCostCVM ??
      pi?.averageCostCvm ??
      pi?.finalCostCVM ??
      pi?.finalCostCvm ??
      pi?.costCVM ??
      pi?.costCvm ??
      null;

    return this.maybeNum(raw);
  }

  private bundleFromCount(cnt: any): CostBundle {
    // ✅ YOUR RULE:
    // - averageCost (OFR) = finalCostOfr
    // - averageCostVM = finalCost (VM)
    // - C and CVM = 0
    const ofr = this.num(cnt?.finalCostOfr);
    const vm = this.num(cnt?.finalCost ?? cnt?.finalCostVM ?? cnt?.finalCostVm);
    return { ofr, vm, c: 0, cvm: 0 };
  }

  // -----------------------------
  // ItemNameDescription (C / CVM)
  // -----------------------------
  private async getDescCostsByVariant(
    manager: EntityManager,
    variantId: number,
  ): Promise<{ descId: number | null; c: number; cvm: number }> {
    const v = await manager.getRepository(ItemVariant).findOne({
      where: { id: variantId } as any,
      select: ['id', 'itemNameDescriptionId'] as any,
    });

    const descId = (v as any)?.itemNameDescriptionId ?? null;
    if (!descId) return { descId: null, c: 0, cvm: 0 };

    const desc = await manager.getRepository(ItemNameDescription).findOne({
      where: { id: descId } as any,
    });

    return {
      descId,
      c: this.num((desc as any)?.averageCostC),
      cvm: this.num((desc as any)?.averageCostCVM),
    };
  }

  private async updateDescCostsByVariant(
    manager: EntityManager,
    variantId: number,
    c: number,
    cvm: number,
  ): Promise<void> {
    const v = await manager.getRepository(ItemVariant).findOne({
      where: { id: variantId } as any,
      select: ['itemNameDescriptionId'] as any,
    });

    const descId = (v as any)?.itemNameDescriptionId ?? null;
    if (!descId) return;

    await manager.getRepository(ItemNameDescription).update(
      { id: descId } as any,
      {
        averageCostC: c,
        averageCostCVM: cvm,
      } as any,
    );
  }

  private async updateVariantCosts(
    manager: EntityManager,
    variantId: number,
    costs: CostBundle,
  ): Promise<void> {
    await manager.getRepository(ItemVariant).update(
      { id: variantId } as any,
      {
        averageCost: costs.ofr,
        averageCostVM: costs.vm,
      } as any,
    );

    // C / CVM live on ItemNameDescription (siblings share it)
    await this.updateDescCostsByVariant(manager, variantId, costs.c, costs.cvm);
  }

  // -----------------------------
  // COST LOOKUP (prev qty + prev costs bundle)
  // -----------------------------
  private async getPrevQtyAndCosts(
    manager: EntityManager,
    variantId: number,
    cut: Date,
  ): Promise<{ prevQty: number; prev: CostBundle }> {
    const txRepo = manager.getRepository(InventoryTransaction);

    // 1) prevQty from inventory_transactions (sqmofr)
    const rawQty = await txRepo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.sqmofr), 0)', 'sum')
      .where('tx.itemVariantId = :vid', { vid: variantId })
      .andWhere('tx.dateForEachInvoice < :cut', { cut })
      .getRawOne<{ sum: string | null }>();

    const prevQty = Number(rawQty?.sum ?? 0) || 0;

    // 2) last COST EVENT before cut (transfer OR purchase OR count)
    const lastTx = await txRepo
      .createQueryBuilder('tx')
      .where('tx.itemVariantId = :vid', { vid: variantId })
      .andWhere('tx.dateForEachInvoice < :cut', { cut })
      .andWhere(
        '(tx.transferId IS NOT NULL OR tx.purchaseInvoiceItemId IS NOT NULL OR tx.inventoryCountId IS NOT NULL)',
      )
      .orderBy('tx.dateForEachInvoice', 'DESC')
      .addOrderBy('tx.id', 'DESC')
      .getOne();

    // current desc values are our best fallback for C/CVM
    const desc = await this.getDescCostsByVariant(manager, variantId);
    let out: CostBundle | null = null;

    if (lastTx) {
      // A) last is COUNT → special rule
      if ((lastTx as any).inventoryCountId) {
        const cnt = await manager.getRepository(InventoryCount).findOne({
          where: { id: (lastTx as any).inventoryCountId } as any,
        });
        out = this.bundleFromCount(cnt);
      }

      // B) last is PURCHASE → copy OFR/VM (and try C/CVM if present on purchase item else desc)
      if (!out && (lastTx as any).purchaseInvoiceItemId) {
        const pi = await manager.getRepository(PurchaseInvoiceItem).findOne({
          where: { id: (lastTx as any).purchaseInvoiceItemId } as any,
        });

        const ofr = this.pickPurchaseOfr(pi) ?? 0;
        const vm = this.pickPurchaseVm(pi) ?? 0;
        const c = this.pickPurchaseC(pi) ?? desc.c;
        const cvm = this.pickPurchaseCvm(pi) ?? desc.cvm;

        out = { ofr, vm, c, cvm };
      }

      // C) last is TRANSFER → copy from transfer item if possible
      if (!out && (lastTx as any).transferId) {
        const ti = await manager.getRepository(TransferItem).findOne({
          where: {
            transferId: (lastTx as any).transferId,
            itemBatchId: (lastTx as any).itemBatchId ?? undefined,
          } as any,
        });

        const ofr =
          this.maybeNum((ti as any)?.averageCost) ??
          this.maybeNum((ti as any)?.price) ??
          this.maybeNum((lastTx as any)?.finalcostofr) ??
          0;

        const vm =
          this.maybeNum((ti as any)?.averageCostVM) ??
          this.maybeNum((lastTx as any)?.finalcost) ??
          0;

        const c =
          this.maybeNum((ti as any)?.averageCostC) ??
          desc.c;

        const cvm =
          this.maybeNum((ti as any)?.averageCostCVM) ??
          desc.cvm;

        out = { ofr, vm, c, cvm };
      }

      // D) last resort: tx fields (tx only has finalcostofr + finalcost)
      if (!out) {
        const ofr = this.maybeNum((lastTx as any)?.finalcostofr) ?? 0;
        const vm = this.maybeNum((lastTx as any)?.finalcost) ?? 0;
        out = { ofr, vm, c: desc.c, cvm: desc.cvm };
      }
    }

    // E) ultimate fallback: latest count cost (OFR/VM), C/CVM from desc
    if (!out) {
      const rawCount = await this.countRepo
        .createQueryBuilder('cnt')
        .select(['cnt.finalCostOfr AS ofr', 'cnt.finalCost AS vm'])
        .where('cnt.itemVariantId = :vid', { vid: variantId })
        .andWhere('cnt.finalCostOfr IS NOT NULL')
        .orderBy('cnt.id', 'DESC')
        .getRawOne<{ ofr: any; vm: any }>();

      const ofr = this.num(rawCount?.ofr);
      const vm = this.num(rawCount?.vm);
      out = { ofr, vm, c: desc.c, cvm: desc.cvm };
    }

    return { prevQty, prev: out };
  }

  // -----------------------------
  // Batch helper
  // -----------------------------
  private async ensureBatch(
    manager: EntityManager,
    variantId: number,
    condition: any,
    dateReceived: any,
  ): Promise<ItemBatch> {
    const batchRepo = manager.getRepository(ItemBatch);

    let b = await batchRepo.findOne({
      where: {
        itemVariant: { id: variantId } as any,
        condition,
        dateReceived,
      } as any,
    });

    if (!b) {
      const dto: DeepPartial<ItemBatch> = {
        itemVariant: { id: variantId } as any,
        condition,
        dateReceived,
        start: 0,
        in: 0,
        out: 0,
        balance: 0,
        startOFR: 0,
        inOFR: 0,
        outOFR: 0,
        balanceOFR: 0,
      };
      b = batchRepo.create(dto);
      b = await batchRepo.save(b);
    }

    return b;
  }

  // -----------------------------
  // SAVE header + items
  // -----------------------------
  private async saveTransferHeaderAndItems(
    manager: EntityManager,
    data: any,
  ): Promise<Transfer> {
    const transferRepo = manager.getRepository(Transfer);

    const transfer = transferRepo.create({
      transferNumber: data.transferNumber,
      date: data.date,
      type: data.type,
      location: data.location,
      items: (data.items || []).map((i: any) =>
        manager.getRepository(TransferItem).create({
          itemBatchId: i.itemBatchId,
          quantity: i.quantity,
          sqm: i.sqm,

          // keep existing line price input (used in ADJ+ if you send it)
          price: i.price,

          // ✅ store these too (you said you added them)
          averageCost: (i as any).averageCost ?? null,
          averageCostVM: (i as any).averageCostVM ?? null,
          averageCostC: (i as any).averageCostC ?? null,
          averageCostCVM: (i as any).averageCostCVM ?? null,

          toItemVariantId: (i as any).toItemVariantId,
          invoiceItemId: i.invoiceItemId,
        } as any),
      ),
    });

    return transferRepo.save(transfer);
  }

  private async insertTransferItems(
    manager: EntityManager,
    transferId: number,
    items: any[],
  ): Promise<void> {
    if (!Array.isArray(items) || !items.length) return;

    const payload: DeepPartial<TransferItem>[] = items.map((i: any) => ({
      transferId,
      itemBatchId: i.itemBatchId,
      quantity: i.quantity,
      sqm: i.sqm,
      price: i.price,

      averageCost: (i as any).averageCost ?? null,
      averageCostVM: (i as any).averageCostVM ?? null,
      averageCostC: (i as any).averageCostC ?? null,
      averageCostCVM: (i as any).averageCostCVM ?? null,

      toItemVariantId: (i as any).toItemVariantId,
      invoiceItemId: i.invoiceItemId,
    }));

    await manager.getRepository(TransferItem).save(payload);
  }

  // -----------------------------
  // ROLLBACK ONLY THIS TRANSFER (qty totals only)
  // -----------------------------
private async rollbackTransfer(
  manager: EntityManager,
  transferId: number,
  opts?: { keepItems?: boolean },
): Promise<void> {
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const txs = await manager.getRepository(InventoryTransaction).find({
    where: { transferId } as any,
    relations: ['itemBatch', 'itemBatch.itemVariant'],
  });

  for (const tx of txs) {
    const batch: any = (tx as any).itemBatch;
    const variant: any = batch?.itemVariant;
    if (!batch || !variant) continue;

    const sqm = Math.abs(num((tx as any).sqmofr));

    if (
      (tx as any).transactionType === 'MovedFrom' ||
      (tx as any).transactionType === 'Breakage' ||
      (tx as any).transactionType === 'Defects' ||
      (tx as any).transactionType === 'Adjustment -'
    ) {
      batch.outOFR = num(batch.outOFR) - sqm;
      variant.totalOutOFR = num(variant.totalOutOFR) - sqm;
    } else if (
      (tx as any).transactionType === 'MovedTo' ||
      (tx as any).transactionType === 'Adjustment +'
    ) {
      batch.inOFR = num(batch.inOFR) - sqm;
      variant.totalInOFR = num(variant.totalInOFR) - sqm;
    }

    batch.balanceOFR = num(batch.startOFR) + num(batch.inOFR) - num(batch.outOFR);
    variant.totalBalanceOFR =
      num(variant.totalStartOFR) + num(variant.totalInOFR) - num(variant.totalOutOFR);

    await manager.getRepository(ItemBatch).save(batch);
    await manager.getRepository(ItemVariant).save(variant);
  }

  // always delete derived tx
  await manager.getRepository(InventoryTransaction).delete({ transferId } as any);

  // ✅ only delete transfer_items when you REALLY want to destroy lines
  if (!opts?.keepItems) {
    await manager.getRepository(TransferItem).delete({ transferId } as any);
  }
}


  // -----------------------------
  // CRUD (NO forward recompute)
  // -----------------------------
async create(data: any): Promise<Transfer[]> {
  console.log("🛠️ TransfersService.create payload:", JSON.stringify(data, null, 2));
  console.log("📊 Number of items in payload:", data?.items?.length);

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) {
    return [];
  }

  const createdTransfers = await this.transfersRepo.manager.transaction(
    async (manager) => {
      const year2 = await this.getActiveYearSuffix(manager);
      const prefix = this.getPrefixFromLocation(data.location);
      const results: Transfer[] = [];

      for (const item of items) {
        const transferNumber = await this.nextTransferNumber(manager, prefix, year2);

        const transfer = await this.saveTransferHeaderAndItems(manager, {
          ...data,
          transferNumber,
          items: [item],
        });

        console.log(`✅ Created NEW transfer #${transfer.id}`); // ← ADD THIS

        await this.applyTransferLogic(manager, transfer, [item]);
        results.push(transfer);
      }

      console.log(`📦 Returning ${results.length} transfers:`, results.map(t => t.id)); // ← ADD THIS
      return results;
    }
  );

  console.log(`🎉 Transaction complete. Created transfers:`, createdTransfers.map(t => t.id)); // ← ADD THIS

  await this.emitActivityNowAndSoon();
  return createdTransfers;
}

async updateTransfer(transferId: number, data: any): Promise<Transfer> {
  const updated = await this.transfersRepo.manager.transaction(async (manager) => {
    console.log('♻️ Updating transfer:', transferId);

    const existing = await this.mustGetTransfer(manager, transferId);
    const transferNumber = (existing as any).transferNumber;

    // ✅ rollback derived tx only (DO NOT delete transfer_items)
    await this.rollbackTransfer(manager, transferId, { keepItems: true });

    // update header (keep same id + same transferNumber)
    await manager.getRepository(Transfer).update(
      { id: transferId } as any,
      {
        transferNumber,
        date: data.date,
        type: data.type,
        location: data.location,
      } as any,
    );

    const repo = manager.getRepository(TransferItem);

    const incoming: any[] = Array.isArray(data?.items) ? data.items : [];

    // load current items WITH sqmPieces so we can prevent accidental loss
    const current = await repo.find({
      where: { transferId } as any,
      relations: ['sqmPieces'] as any,
    });

    const currentById = new Map<number, any>();
    for (const c of current as any[]) currentById.set(Number(c.id), c);

    const incomingIds = new Set<number>(
      incoming.map((x) => Number(x.id)).filter((n) => Number.isFinite(n) && n > 0),
    );

    // 1) upsert (update existing by id, insert new without id)
    const toSave = incoming.map((i: any) => ({
      id: i.id ? Number(i.id) : undefined,
      transferId,
      itemBatchId: i.itemBatchId,
      quantity: i.quantity,
      sqm: i.sqm,
      price: i.price,

      averageCost: (i as any).averageCost ?? null,
      averageCostVM: (i as any).averageCostVM ?? null,
      averageCostC: (i as any).averageCostC ?? null,
      averageCostCVM: (i as any).averageCostCVM ?? null,

      toItemVariantId: (i as any).toItemVariantId ?? null,
      invoiceItemId: i.invoiceItemId ?? null,
    }));

    await repo.save(toSave as any);

    // 2) delete removed lines SAFELY
    const removed = (current as any[]).filter((c) => !incomingIds.has(Number(c.id)));

    // ✅ if removed lines have sqmPieces, block deletion to avoid silent data loss
    const blocked = removed.filter((r) => Array.isArray(r.sqmPieces) && r.sqmPieces.length > 0);
    if (blocked.length) {
      throw new BadRequestException(
        `Cannot remove ${blocked.length} transfer line(s) because they have sqmPieces linked. ` +
        `Remove/resolve pieces first or keep the line and set qty/sqm to 0.`,
      );
    }

    if (removed.length) {
      await repo.delete({ id: In(removed.map((r) => Number(r.id))) } as any);
    }

    // 3) re-apply logic → recreates tx + totals + costs
    const reloaded = await this.mustGetTransfer(manager, transferId);
    await this.applyTransferLogic(manager, reloaded, incoming);

    return reloaded;
  });

  await this.emitActivityNowAndSoon();
  return updated;
}


  async remove(id: number): Promise<void> {
    await this.transfersRepo.manager.transaction(async (manager) => {
      await this.mustGetTransfer(manager, id);

      await this.rollbackTransfer(manager, id);
      await manager.getRepository(Transfer).delete({ id } as any);
    });

    await this.emitActivityNowAndSoon();
  }

  // -----------------------------
  // Reads
  // -----------------------------
  async findAll(): Promise<Transfer[]> {
    return this.transfersRepo.find({ relations: ['items'] });
  }

  async findOne(id: number): Promise<Transfer> {
    const t = await this.transfersRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!t) throw new NotFoundException(`Transfer #${id} not found`);
    return t;
  }

  async finddetails(): Promise<Transfer[]> {
    return this.transfersRepo.find({
      relations: [
        'items',
        'items.itemBatch',
        'items.itemBatch.itemVariant',
        'items.itemBatch.itemVariant.thickness',
        'items.itemBatch.itemVariant.thickness.item',
      ],
      order: { id: 'DESC' },
    });
  }

  // -----------------------------
  // QUEUE / REPORTS (unchanged)
  // -----------------------------
  async getCutsQueue(opts?: {
    page?: number;
    limit?: number;
    status?: 'pending' | 'resolved' | 'all';
    from?: string; // YYYY-MM-DD
    to?: string; // YYYY-MM-DD
    q?: string;
  }) {
    const page = Math.max(1, Number(opts?.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));
    const start = (page - 1) * limit;

    const status = String(opts?.status ?? 'pending').toLowerCase() as
      | 'pending'
      | 'resolved'
      | 'all';

    const q = String(opts?.q ?? '').trim();
    const from = opts?.from ? String(opts.from).slice(0, 10) : null;
    const to = opts?.to ? String(opts.to).slice(0, 10) : null;

    const base = this.itemsRepo
      .createQueryBuilder('ti')
      .leftJoin('ti.transfer', 't')
      .leftJoin('ti.itemVariant', 'v')
      .leftJoin('v.thickness', 'th')
      .leftJoin('th.item', 'item')
      .leftJoin('ti.itemBatch', 'batch')
      .leftJoin('ti.invoiceItem', 'ii')
      .leftJoin('ii.invoice', 'inv')
      .leftJoin('inv.customer', 'cust')
      .where('ti.invoiceItemId IS NOT NULL');

    if (status === 'pending') base.andWhere('ti.sqmTrashUnallocated > 0');
    else if (status === 'resolved') base.andWhere('ti.sqmTrashUnallocated <= 0');

    if (from) base.andWhere('t.date >= :from', { from });
    if (to) base.andWhere('t.date <= :to', { to });

    if (q) {
      base.andWhere(
        `(
          inv.invoiceNumber LIKE :q
          OR CAST(inv.id AS CHAR) LIKE :q
          OR cust.customerName LIKE :q
          OR item.itemName LIKE :q
          OR v.origin LIKE :q
          OR CAST(batch.id AS CHAR) LIKE :q
        )`,
        { q: `%${q}%` },
      );
    }

    const countRow = await base
      .clone()
      .select('COUNT(DISTINCT ti.id)', 'cnt')
      .getRawOne<{ cnt: string }>();

    const total = Number(countRow?.cnt ?? 0);

    const idRows = await base
      .clone()
      .select('ti.id', 'id')
      .addSelect('t.date', 'tdate')
      .distinct(true)
      .orderBy('t.date', 'DESC')
      .addOrderBy('ti.id', 'DESC')
      .offset(start)
      .limit(limit)
      .getRawMany<{ id: string; tdate: string }>();

    const ids = idRows
      .map((r) => Number(r.id))
      .filter((n) => Number.isFinite(n));

    if (!ids.length) {
      return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
        data: [],
      };
    }

    const items = await this.itemsRepo.find({
      where: { id: In(ids) },
      relations: {
        transfer: true,
        itemVariant: { thickness: { item: true } },
        itemBatch: true,
        sqmPieces: true,
        invoiceItem: { invoice: { customer: true } },
      } as any,
    });

    const byId = new Map(items.map((x) => [Number((x as any).id), x]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as TransferItem[];

    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const data = ordered.map((ti) => {
      const v: any = (ti as any).itemVariant;
      const item: any = v?.thickness?.item;

      const ii: any = (ti as any).invoiceItem;
      const inv: any = ii?.invoice;
      const cust: any = inv?.customer;

      const original = {
        length: num(v?.length),
        width: num(v?.width),
        sheetsPerBox: num(v?.sheetsPerBox),
      };

      const snapshot = {
        length: ii?.length == null ? null : num(ii.length),
        width: ii?.width == null ? null : num(ii.width),
        sheetsPerBox: ii?.sheetsPerBox == null ? null : num(ii.sheetsPerBox),
      };

      const changed =
        snapshot.length != null && snapshot.width != null
          ? {
              length: Math.abs(num(snapshot.length) - original.length) > 0.001,
              width: Math.abs(num(snapshot.width) - original.width) > 0.001,
              sheetsPerBox:
                snapshot.sheetsPerBox != null &&
                Math.abs(num(snapshot.sheetsPerBox) - original.sheetsPerBox) > 0.1,
            }
          : { length: false, width: false, sheetsPerBox: false };

      const pieces = Array.isArray((ti as any).sqmPieces) ? (ti as any).sqmPieces : [];
      const piecesSum = pieces.reduce((s: number, p: any) => s + num(p?.sqm), 0);

      const remaining = num((ti as any).sqmTrashUnallocated);
      const status =
        remaining > 0 ? 'pending' : piecesSum > 0 ? 'stocked' : 'trashed';

      return {
        transferId: (ti as any).transferId ?? (ti as any).transfer?.id ?? null,
        transferItemId: (ti as any).id,
        transferDate: (ti as any).transfer?.date ?? null,
        transferNumber: (ti as any).transfer?.transferNumber ?? null,

        invoiceId: inv?.id ?? null,
        invoiceNumber: inv?.invoiceNumber ?? null,
        invoiceDate: inv?.date ?? null,
        customerName: cust?.customerName ?? null,

        invoiceItemId: ii?.id ?? (ti as any).invoiceItemId ?? null,

        itemName: item?.itemName ?? null,
        itemType: String(item?.type ?? '').toLowerCase(),
        stockMode: String(item?.stockMode ?? '').toUpperCase(),

        itemVariantId: (ti as any).itemVariantId ?? v?.id ?? null,
        itemBatchId: (ti as any).itemBatchId ?? (ti as any).itemBatch?.id ?? null,
        origin: v?.origin ?? null,

        sold: {
          sqm: ii?.sqm == null ? null : num(ii.sqm),
          quantity: ii?.quantity == null ? null : num(ii.quantity),
          snapshotDims: snapshot,
          originalDims: original,
          changed,
        },

        stock: {
          consumedSqm: num((ti as any).sqm),
          remainingSqm: remaining,
          piecesSum: Number(piecesSum.toFixed(4)),
          pieces: pieces.map((p: any) => ({ id: p?.id ?? null, sqm: num(p?.sqm) })),
          status,
        },
      };
    });

    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
      data,
    };
  }

  async getInvoiceDimChanges(opts?: { page?: number; limit?: number; q?: string }) {
    const page = Math.max(1, Number(opts?.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));
    const start = (page - 1) * limit;

    const q = String(opts?.q ?? '').trim();

    const tolLenWid = 0.001;
    const tolSpb = 0.1;

    const qb = this.invoiceItemRepo
      .createQueryBuilder('ii')
      .leftJoin('ii.invoice', 'inv')
      .leftJoin('inv.customer', 'cust')
      .leftJoin('ii.itemVariant', 'v')
      .leftJoin('v.thickness', 'th')
      .leftJoin('th.item', 'item')
      .where('ii.itemVariantId IS NOT NULL')
      .andWhere(
        `(
          (ii.length IS NOT NULL AND ABS(ii.length - v.length) > :tolLenWid)
          OR
          (ii.width IS NOT NULL AND ABS(ii.width - v.width) > :tolLenWid)
          OR
          (ii.sheetsPerBox IS NOT NULL AND ABS(ii.sheetsPerBox - v.sheetsPerBox) > :tolSpb)
        )`,
        { tolLenWid, tolSpb },
      );

    if (q) {
      qb.andWhere(
        `(
          inv.invoiceNumber LIKE :q
          OR CAST(inv.id AS CHAR) LIKE :q
          OR cust.customerName LIKE :q
          OR item.itemName LIKE :q
          OR v.origin LIKE :q
          OR CAST(ii.id AS CHAR) LIKE :q
        )`,
        { q: `%${q}%` },
      );
    }

    const totalRow = await qb.clone().select('COUNT(ii.id)', 'cnt').getRawOne<{ cnt: string }>();
    const total = Number(totalRow?.cnt ?? 0);

    const rows = await qb
      .clone()
      .select([
        'ii.id AS invoiceItemId',
        'inv.id AS invoiceId',
        'inv.invoiceNumber AS invoiceNumber',
        'inv.date AS invoiceDate',
        'cust.customerName AS customerName',
        'item.id AS itemId',
        'item.itemName AS itemName',
        'item.type AS itemType',
        'item.stockMode AS stockMode',
        'v.id AS itemVariantId',
        'v.origin AS origin',
        'th.thickness AS thickness',
        'ii.length AS snapLength',
        'ii.width AS snapWidth',
        'ii.sheetsPerBox AS snapSpb',
        'v.length AS origLength',
        'v.width AS origWidth',
        'v.sheetsPerBox AS origSpb',
        'ii.sqm AS soldSqm',
        'ii.quantity AS soldQty',
      ])
      .orderBy('inv.date', 'DESC')
      .addOrderBy('inv.id', 'DESC')
      .addOrderBy('ii.id', 'DESC')
      .offset(start)
      .limit(limit)
      .getRawMany<any>();

    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const data = rows.map((r) => {
      const snapLength = num(r.snapLength);
      const snapWidth = num(r.snapWidth);
      const snapSpb = num(r.snapSpb);

      const origLength = num(r.origLength) ?? 0;
      const origWidth = num(r.origWidth) ?? 0;
      const origSpb = num(r.origSpb) ?? 0;

      const changed = {
        length: snapLength != null ? Math.abs(snapLength - origLength) > tolLenWid : false,
        width: snapWidth != null ? Math.abs(snapWidth - origWidth) > tolLenWid : false,
        sheetsPerBox: snapSpb != null ? Math.abs(snapSpb - origSpb) > tolSpb : false,
      };

      return {
        invoiceItemId: Number(r.invoiceItemId),
        invoiceId: Number(r.invoiceId),
        invoiceNumber: r.invoiceNumber ?? null,
        invoiceDate: r.invoiceDate ?? null,
        customerName: r.customerName ?? null,

        itemName: r.itemName ?? null,
        itemType: String(r.itemType ?? '').toLowerCase(),
        stockMode: String(r.stockMode ?? '').toUpperCase(),

        itemVariantId: Number(r.itemVariantId),
        origin: r.origin ?? null,
        thickness: num(r.thickness),

        sold: { sqm: num(r.soldSqm), quantity: num(r.soldQty) },

        snapshotDims: { length: snapLength, width: snapWidth, sheetsPerBox: snapSpb },
        originalDims: { length: origLength, width: origWidth, sheetsPerBox: origSpb },
        changed,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return { page, limit, total, totalPages, hasMore: page < totalPages, data };
  }

  // -----------------------------
  // APPLY TRANSFER LOGIC
  // - averageCost (OFR): weighted avg updates
  // - averageCostVM: copied from prev event (not averaged)
  // - averageCostC / averageCostCVM: copied and stored on ItemNameDescription
  // - InventoryTransaction has ONLY finalcostofr (OFR) + finalcost (VM)
  // - NO forward transfer recompute
  // -----------------------------
  private async applyTransferLogic(
 manager: EntityManager,
  transfer: Transfer,
  rawItems: any[] = [],
): Promise<void> {
  // ✅ ADD THESE LOGS HERE - BEFORE ANYTHING ELSE
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔧 applyTransferLogic START`);
  console.log(`   Transfer ID: ${(transfer as any).id}`);
  console.log(`   Location: ${(transfer as any).location}`);
  console.log(`   Items in transfer object: ${(transfer as any).items?.length || 0}`);
  console.log(`   rawItems parameter: ${rawItems?.length || 0}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const num = (v: any): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const persisted = await manager
    .getRepository(TransferItem)
    .createQueryBuilder('ti')
    .leftJoinAndSelect('ti.itemBatch', 'batch')
    .leftJoinAndSelect('batch.itemVariant', 'variant')
    .leftJoinAndSelect('variant.thickness', 'thickness')
    .leftJoinAndSelect('thickness.item', 'item')
    .where('ti.transferId = :tid', { tid: (transfer as any).id })
    .getMany();

  console.log('🔍 Loaded transfer items:', persisted.map((ti: any) => ({
    id: ti.id,
    itemBatchId: ti.itemBatchId,
    toItemVariantId: ti.toItemVariantId,
  })));


    // InventoryTransaction: only these 2 exist in your schem
    const setTxCosts = (tx: any, costs: CostBundle) => {
      tx.finalcostofr = costs.ofr; // OFR
      tx.finalcost = costs.vm;     // VM
    };

    type Agg = {
      totalSqm: number;
      weightedCostOfr: number;
      transferItemIds: number[];
      txInIds: number[];
      copied: Pick<CostBundle, 'vm' | 'c' | 'cvm'> | null;
    };

    const rememberCopied = (agg: Agg, costs: CostBundle) => {
      if (!agg.copied) {
        agg.copied = { vm: costs.vm, c: costs.c, cvm: costs.cvm };
        return;
      }
      const eps = 1e-6;
      const diff =
        Math.abs((agg.copied.vm ?? 0) - costs.vm) > eps ||
        Math.abs((agg.copied.c ?? 0) - costs.c) > eps ||
        Math.abs((agg.copied.cvm ?? 0) - costs.cvm) > eps;

      if (diff) {
        console.warn(
          '⚠️ Copied costs differ across lines for same destination variant. Keeping first copy.',
          { first: agg.copied, next: { vm: costs.vm, c: costs.c, cvm: costs.cvm } },
        );
      }
    };

    const updateLinesAndTx = async (
      destVariantId: number,
      transferItemIds: number[],
      txInIds: number[],
      newAvgOfr: number,
      copied: { vm: number; c: number; cvm: number },
    ) => {
      // Update destination variant costs
      await this.updateVariantCosts(manager, destVariantId, {
        ofr: newAvgOfr,
        vm: copied.vm,
        c: copied.c,
        cvm: copied.cvm,
      });

      // Update transfer lines
      if (transferItemIds.length) {
        await manager.getRepository(TransferItem).update(
          { id: In(transferItemIds) } as any,
          {
            price: newAvgOfr,         // keep old behavior
            averageCost: newAvgOfr,   // new field
            averageCostVM: copied.vm,
            averageCostC: copied.c,
            averageCostCVM: copied.cvm,
          } as any,
        );
      }

      // Update txIn costs
      if (txInIds.length) {
        await manager.getRepository(InventoryTransaction).update(
          { id: In(txInIds) } as any,
          {
            finalcostofr: newAvgOfr,
            finalcost: copied.vm,
          } as any,
        );
      }
    };

    // -----------------------------
    // JF: box → sheet
    // -----------------------------
    if ((transfer as any).location === 'JF') {
      const cut = this.startOfDay(new Date((transfer as any).date));
      const sheetAgg = new Map<number, Agg>();

      for (const ti of persisted) {
        const qtyBoxes = num((ti as any).quantity);
        const fromBatch: any = (ti as any).itemBatch;
        const fromVariant: any = fromBatch.itemVariant;
        const parentItem: any = fromVariant.thickness.item;

        if (parentItem.type !== 'box') {
          throw new BadRequestException(
            `JF transfers only accept box-type items. Found ${parentItem.itemName} (${parentItem.type})`,
          );
        }

        const sheetThickness = await manager
          .getRepository(Thickness)
          .createQueryBuilder('th')
          .innerJoin('th.item', 'it', 'it.itemName = :name AND it.type = :type', {
            name: parentItem.itemName,
            type: 'sheet',
          })
          .where('th.thickness = :thick', { thick: fromVariant.thickness.thickness })
          .getOne();

        if (!sheetThickness) {
          throw new NotFoundException(
            `No sheet-type thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
          );
        }

        const sheetVariant = await manager.getRepository(ItemVariant).findOne({
          where: {
            thickness: { id: (sheetThickness as any).id } as any,
            origin: fromVariant.origin,
            length: fromVariant.length,
            width: fromVariant.width,
          } as any,
        });

        if (!sheetVariant) {
          throw new NotFoundException(
            `No sheet variant for ${parentItem.itemName} @ ${fromVariant.length}×${fromVariant.width} origin=${fromVariant.origin}`,
          );
        }

        const sheetsPerBox = num(fromVariant.sheetsPerBox);
        const sheetCount = qtyBoxes * sheetsPerBox;

        const lengthM = num(fromVariant.length) / 100;
        const widthM = num(fromVariant.width) / 100;
        const sheetArea = lengthM * widthM;
        const totalSqm = sheetCount * sheetArea;

        const { prev: prevCosts } = await this.getPrevQtyAndCosts(manager, fromVariant.id, cut);
        const transferCosts: CostBundle = { ...prevCosts };

        const toBatch = await this.ensureBatch(
          manager,
          (sheetVariant as any).id,
          fromBatch.condition,
          fromBatch.dateReceived,
        );

        const txOut: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: fromVariant.id,
          itemBatchId: fromBatch.id,
          transactionType: 'MovedFrom',
          quantity: 0,
          quantityofr: -qtyBoxes,
          sqm: 0,
          sqmofr: -totalSqm,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txOut, transferCosts);
        this.logIfNaN(txOut, 'JF.txOut');
        await manager.getRepository(InventoryTransaction).save(txOut);

        const txIn: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: (sheetVariant as any).id,
          itemBatchId: (toBatch as any).id,
          transactionType: 'MovedTo',
          quantity: 0,
          quantityofr: sheetCount,
          sqm: 0,
          sqmofr: totalSqm,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txIn, transferCosts);
        this.logIfNaN(txIn, 'JF.txIn');
        const savedTxIn = await manager.getRepository(InventoryTransaction).save(txIn);

        // totals
        fromBatch.outOFR = num(fromBatch.outOFR) + totalSqm;
        fromBatch.balanceOFR = num(fromBatch.startOFR) + num(fromBatch.inOFR) - num(fromBatch.outOFR);
        await manager.getRepository(ItemBatch).save(fromBatch);

        (toBatch as any).inOFR = num((toBatch as any).inOFR) + totalSqm;
        (toBatch as any).balanceOFR =
          num((toBatch as any).startOFR) + num((toBatch as any).inOFR) - num((toBatch as any).outOFR);
        await manager.getRepository(ItemBatch).save(toBatch);

        fromVariant.totalOutOFR = num(fromVariant.totalOutOFR) + totalSqm;
        fromVariant.totalBalanceOFR =
          num(fromVariant.totalStartOFR) + num(fromVariant.totalInOFR) - num(fromVariant.totalOutOFR);

        (sheetVariant as any).totalInOFR = num((sheetVariant as any).totalInOFR) + totalSqm;
        (sheetVariant as any).totalBalanceOFR =
          num((sheetVariant as any).totalStartOFR) +
          num((sheetVariant as any).totalInOFR) -
          num((sheetVariant as any).totalOutOFR);

        await manager.getRepository(ItemVariant).save([fromVariant, sheetVariant as any]);

        const key = Number((sheetVariant as any).id);
        const agg = sheetAgg.get(key) ?? {
          totalSqm: 0,
          weightedCostOfr: 0,
          transferItemIds: [],
          txInIds: [],
          copied: null,
        };

        agg.totalSqm += totalSqm;
        agg.weightedCostOfr += totalSqm * transferCosts.ofr;
        agg.transferItemIds.push((ti as any).id);
        agg.txInIds.push((savedTxIn as any).id);
        rememberCopied(agg, transferCosts);
        sheetAgg.set(key, agg);
      }

      for (const [destVariantId, agg] of sheetAgg.entries()) {
        if (agg.totalSqm <= 0) continue;

        const { prevQty, prev: prevCostsDest } = await this.getPrevQtyAndCosts(manager, destVariantId, cut);
        const inCostOfr = agg.weightedCostOfr / agg.totalSqm;
        const newAvgOfr = this.computeNewAvgCost(prevQty, prevCostsDest.ofr, agg.totalSqm, inCostOfr);

        const copied = agg.copied ?? { vm: prevCostsDest.vm, c: prevCostsDest.c, cvm: prevCostsDest.cvm };
        await updateLinesAndTx(destVariantId, agg.transferItemIds, agg.txInIds, newAvgOfr, copied);
      }
    }

    // -----------------------------
    // FJ: sheet → box
    // -----------------------------
if ((transfer as any).location === 'FJ') {
  const cut = this.startOfDay(new Date((transfer as any).date));
  const boxAgg = new Map<number, Agg>();

  for (const ti of persisted) {
    // ✅ quantity = number of SHEETS being transferred (not boxes!)
    const qtySheets = num((ti as any).quantity);
    const sqmVal = num((ti as any).sqm);

    const fromBatch: any = (ti as any).itemBatch;
    const fromVariant: any = fromBatch.itemVariant;
    const parentItem: any = fromVariant.thickness.item;

    // =====================================================================
    // VALIDATION: Must be sheet type
    // =====================================================================
    if (parentItem.type !== 'sheet') {
      throw new BadRequestException(
        `FJ transfers only accept sheet-type items. Found ${parentItem.itemName} (${parentItem.type})`,
      );
    }

    // =====================================================================
    // GET TARGET BOX VARIANT ID
    // =====================================================================
    
    // ✅ Try persisted first, then fallback to rawItems
    let boxVariantId = (ti as any).toItemVariantId 
      ? Number((ti as any).toItemVariantId) 
      : null;

    if (!boxVariantId) {
      const rawItem = (rawItems ?? []).find(
        (row: any) => Number(row.itemBatchId) === Number((ti as any).itemBatchId),
      );
      boxVariantId = rawItem?.toItemVariantId 
        ? Number(rawItem.toItemVariantId) 
        : null;
    }

    if (!boxVariantId) {
      throw new BadRequestException(
        `FJ transfer requires "toItemVariantId" for itemBatchId=${(ti as any).itemBatchId}`,
      );
    }

    // =====================================================================
    // LOAD TARGET BOX VARIANT
    // =====================================================================
    const boxVariant: any = await manager.getRepository(ItemVariant).findOne({
      where: { id: boxVariantId } as any,
      relations: ['thickness', 'thickness.item'] as any,
    });
    
    if (!boxVariant) {
      throw new NotFoundException(`Target box ItemVariant ${boxVariantId} not found.`);
    }

    const boxItem: any = boxVariant.thickness.item;
    if (boxItem.type !== 'box') {
      throw new BadRequestException(
        `FJ target must be a "box" item. Got ${boxItem.itemName} (${boxItem.type}).`,
      );
    }

    // =====================================================================
    // VALIDATE DIVISIBILITY
    // =====================================================================
    const targetSheetsPerBox = num(boxVariant.sheetsPerBox);
    
    if (!targetSheetsPerBox || targetSheetsPerBox <= 0) {
      throw new BadRequestException(
        `Target box variant ${boxVariantId} has invalid sheetsPerBox (${targetSheetsPerBox}). Must be > 0.`,
      );
    }

    // ✅ Check if quantity of sheets is divisible by sheetsPerBox
    if (qtySheets % targetSheetsPerBox !== 0) {
      throw new BadRequestException(
        `Cannot convert ${qtySheets} sheets to boxes with ${targetSheetsPerBox} sheets/box. ` +
        `Quantity must be divisible by ${targetSheetsPerBox}. ` +
        `(${qtySheets} ÷ ${targetSheetsPerBox} = ${qtySheets / targetSheetsPerBox})`,
      );
    }

    // ✅ Calculate how many boxes will be created
    const qtyBoxes = qtySheets / targetSheetsPerBox;

    console.log(
      `✅ FJ: Converting ${qtySheets} sheets → ${qtyBoxes} boxes ` +
      `(${targetSheetsPerBox} sheets/box, ${sqmVal} sqm)`
    );

    // =====================================================================
    // GET COSTS FROM HISTORY
    // =====================================================================
    const { prev: prevCosts } = await this.getPrevQtyAndCosts(manager, fromVariant.id, cut);
    const transferCosts: CostBundle = { ...prevCosts };

    // =====================================================================
    // ENSURE TARGET BATCH EXISTS
    // =====================================================================
    const toBatch = await this.ensureBatch(
      manager,
      boxVariant.id,
      fromBatch.condition,
      fromBatch.dateReceived,
    );

    // =====================================================================
    // CREATE "OUT" TRANSACTION (Remove sheets from stock)
    // =====================================================================
    const txOut: any = manager.getRepository(InventoryTransaction).create({
      itemVariantId: fromVariant.id,
      itemBatchId: fromBatch.id,
      transactionType: 'MovedFrom',
      quantity: 0,
      quantityofr: -qtySheets,              // ✅ Negative sheets OUT
      sqm: 0,
      sqmofr: -sqmVal,                      // ✅ Negative SQM OUT
      transferId: (transfer as any).id,
      dateForEachInvoice: new Date((transfer as any).date),
    } as any);
    
    setTxCosts(txOut, transferCosts);
    this.logIfNaN(txOut, 'FJ.txOut');
    await manager.getRepository(InventoryTransaction).save(txOut);

    // =====================================================================
    // CREATE "IN" TRANSACTION (Add boxes to stock)
    // =====================================================================
    const txIn: any = manager.getRepository(InventoryTransaction).create({
      itemVariantId: boxVariant.id,
      itemBatchId: (toBatch as any).id,
      transactionType: 'MovedTo',
      quantity: 0,
      quantityofr: qtyBoxes,                // ✅ Positive boxes IN
      sqm: 0,
      sqmofr: sqmVal,                       // ✅ Positive SQM IN
      transferId: (transfer as any).id,
      dateForEachInvoice: new Date((transfer as any).date),
    } as any);
    
    setTxCosts(txIn, transferCosts);
    this.logIfNaN(txIn, 'FJ.txIn');
    const savedTxIn = await manager.getRepository(InventoryTransaction).save(txIn);

    // =====================================================================
    // UPDATE SOURCE BATCH TOTALS (SHEETS)
    // =====================================================================
    fromBatch.outOFR = num(fromBatch.outOFR) + sqmVal;
    fromBatch.balanceOFR = 
      num(fromBatch.startOFR) + 
      num(fromBatch.inOFR) - 
      num(fromBatch.outOFR);
    
    await manager.getRepository(ItemBatch).save(fromBatch);

    // =====================================================================
    // UPDATE DESTINATION BATCH TOTALS (BOXES)
    // =====================================================================
    (toBatch as any).inOFR = num((toBatch as any).inOFR) + sqmVal;
    (toBatch as any).balanceOFR =
      num((toBatch as any).startOFR) + 
      num((toBatch as any).inOFR) - 
      num((toBatch as any).outOFR);
    
    await manager.getRepository(ItemBatch).save(toBatch);

    // =====================================================================
    // UPDATE SOURCE VARIANT TOTALS (SHEETS)
    // =====================================================================
    fromVariant.totalOutOFR = num(fromVariant.totalOutOFR) + sqmVal;
    fromVariant.totalBalanceOFR =
      num(fromVariant.totalStartOFR) + 
      num(fromVariant.totalInOFR) - 
      num(fromVariant.totalOutOFR);

    // =====================================================================
    // UPDATE DESTINATION VARIANT TOTALS (BOXES)
    // =====================================================================
    boxVariant.totalInOFR = num(boxVariant.totalInOFR) + sqmVal;
    boxVariant.totalBalanceOFR =
      num(boxVariant.totalStartOFR) + 
      num(boxVariant.totalInOFR) - 
      num(boxVariant.totalOutOFR);

    // ✅ SAVE BOTH VARIANTS
    await manager.getRepository(ItemVariant).save([fromVariant, boxVariant]);

    // =====================================================================
    // ACCUMULATE FOR WEIGHTED AVERAGE (by destination box variant)
    // =====================================================================
    const key = Number(boxVariant.id);
    const agg = boxAgg.get(key) ?? {
      totalSqm: 0,
      weightedCostOfr: 0,
      transferItemIds: [],
      txInIds: [],
      copied: null,
    };

    agg.totalSqm += sqmVal;
    agg.weightedCostOfr += sqmVal * transferCosts.ofr;
    agg.transferItemIds.push((ti as any).id);
    agg.txInIds.push((savedTxIn as any).id);
    rememberCopied(agg, transferCosts);
    
    boxAgg.set(key, agg);
  }

  // =====================================================================
  // UPDATE DESTINATION BOX VARIANT COSTS (Weighted Average)
  // =====================================================================
  for (const [destVariantId, agg] of boxAgg.entries()) {
    if (agg.totalSqm <= 0) continue;

    // Get previous quantity and costs for the box variant
    const { prevQty, prev: prevCostsDest } = await this.getPrevQtyAndCosts(
      manager, 
      destVariantId, 
      cut
    );
    
    // Weighted average cost of incoming transfer
    const inCostOfr = agg.weightedCostOfr / agg.totalSqm;
    
    // ✅ Compute NEW weighted average for OFR cost
    const newAvgOfr = this.computeNewAvgCost(
      prevQty, 
      prevCostsDest.ofr, 
      agg.totalSqm, 
      inCostOfr
    );

    // ✅ VM/C/CVM are COPIED (not averaged)
    const copied = agg.copied ?? { 
      vm: prevCostsDest.vm, 
      c: prevCostsDest.c, 
      cvm: prevCostsDest.cvm 
    };

    // ✅ Update ItemVariant costs + ItemNameDescription costs + all transfer lines
    await updateLinesAndTx(
      destVariantId, 
      agg.transferItemIds, 
      agg.txInIds, 
      newAvgOfr, 
      copied
    );
  }
}



    // -----------------------------
    // BOSTS: box/sheet → sqm
    // -----------------------------
    if ((transfer as any).location === 'BOSTS') {
      const cut = this.startOfDay(new Date((transfer as any).date));
      const sqmAgg = new Map<number, Agg>();

      for (const ti of persisted) {
        const qty = num((ti as any).quantity);
        const fromBatch: any = (ti as any).itemBatch;
        const fromVariant: any = fromBatch.itemVariant;
        const parentItem: any = fromVariant.thickness.item;

        if (parentItem.type !== 'box' && parentItem.type !== 'sheet') continue;

        const lengthM = num(fromVariant.length) / 100;
        const widthM = num(fromVariant.width) / 100;
        const sheetArea = lengthM * widthM;

        const totalSqm =
          parentItem.type === 'box'
            ? qty * num(fromVariant.sheetsPerBox) * sheetArea
            : qty * sheetArea;

        const { prev: prevCosts } = await this.getPrevQtyAndCosts(manager, fromVariant.id, cut);
        const transferCosts: CostBundle = { ...prevCosts };

        const sqmThickness = await manager
          .getRepository(Thickness)
          .createQueryBuilder('th')
          .innerJoin('th.item', 'it', 'it.itemName = :name AND it.type = :type', {
            name: parentItem.itemName,
            type: 'sqm',
          })
          .where('th.thickness = :thick', { thick: fromVariant.thickness.thickness })
          .getOne();

        if (!sqmThickness) {
          throw new NotFoundException(
            `No "sqm" thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
          );
        }

        const sqmVariants = await manager.getRepository(ItemVariant).find({
          where: { thickness: { id: (sqmThickness as any).id } as any } as any,
        });

        const sqmVariant = sqmVariants.find(
          (v: any) => v.realDescriptionId !== null && v.realDescriptionId !== undefined,
        );

        if (!sqmVariant) {
          throw new NotFoundException(
            `No sqm variant with realDescriptionId for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}`,
          );
        }

        const toBatch = await this.ensureBatch(
          manager,
          (sqmVariant as any).id,
          fromBatch.condition,
          fromBatch.dateReceived,
        );

        const txOut: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: fromVariant.id,
          itemBatchId: fromBatch.id,
          transactionType: 'MovedFrom',
          quantity: 0,
          quantityofr: -qty,
          sqm: 0,
          sqmofr: -totalSqm,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txOut, transferCosts);
        this.logIfNaN(txOut, 'BOSTS.txOut');
        await manager.getRepository(InventoryTransaction).save(txOut);

        const txIn: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: (sqmVariant as any).id,
          itemBatchId: (toBatch as any).id,
          transactionType: 'MovedTo',
          quantity: 0,
          quantityofr: totalSqm,
          sqm: 0,
          sqmofr: totalSqm,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txIn, transferCosts);
        this.logIfNaN(txIn, 'BOSTS.txIn');
        const savedTxIn = await manager.getRepository(InventoryTransaction).save(txIn);

        // totals
        fromBatch.outOFR = num(fromBatch.outOFR) + totalSqm;
        fromBatch.balanceOFR = num(fromBatch.startOFR) + num(fromBatch.inOFR) - num(fromBatch.outOFR);
        await manager.getRepository(ItemBatch).save(fromBatch);

        (toBatch as any).inOFR = num((toBatch as any).inOFR) + totalSqm;
        (toBatch as any).balanceOFR =
          num((toBatch as any).startOFR) + num((toBatch as any).inOFR) - num((toBatch as any).outOFR);
        await manager.getRepository(ItemBatch).save(toBatch);

        fromVariant.totalOutOFR = num(fromVariant.totalOutOFR) + totalSqm;
        fromVariant.totalBalanceOFR =
          num(fromVariant.totalStartOFR) + num(fromVariant.totalInOFR) - num(fromVariant.totalOutOFR);

        (sqmVariant as any).totalInOFR = num((sqmVariant as any).totalInOFR) + totalSqm;
        (sqmVariant as any).totalBalanceOFR =
          num((sqmVariant as any).totalStartOFR) +
          num((sqmVariant as any).totalInOFR) -
          num((sqmVariant as any).totalOutOFR);

        await manager.getRepository(ItemVariant).save([fromVariant, sqmVariant as any]);

        const key = Number((sqmVariant as any).id);
        const agg = sqmAgg.get(key) ?? {
          totalSqm: 0,
          weightedCostOfr: 0,
          transferItemIds: [],
          txInIds: [],
          copied: null,
        };

        agg.totalSqm += totalSqm;
        agg.weightedCostOfr += totalSqm * transferCosts.ofr;
        agg.transferItemIds.push((ti as any).id);
        agg.txInIds.push((savedTxIn as any).id);
        rememberCopied(agg, transferCosts);
        sqmAgg.set(key, agg);
      }

      for (const [destVariantId, agg] of sqmAgg.entries()) {
        if (agg.totalSqm <= 0) continue;

        const { prevQty, prev: prevCostsDest } = await this.getPrevQtyAndCosts(manager, destVariantId, cut);
        const inCostOfr = agg.weightedCostOfr / agg.totalSqm;
        const newAvgOfr = this.computeNewAvgCost(prevQty, prevCostsDest.ofr, agg.totalSqm, inCostOfr);

        const copied = agg.copied ?? { vm: prevCostsDest.vm, c: prevCostsDest.c, cvm: prevCostsDest.cvm };
        await updateLinesAndTx(destVariantId, agg.transferItemIds, agg.txInIds, newAvgOfr, copied);
      }
    }

    // -----------------------------
    // STBOS: sqm → box/sheet
    // -----------------------------
    if ((transfer as any).location === 'STBOS') {
      const cut = this.startOfDay(new Date((transfer as any).date));
      const destAgg = new Map<number, Agg>();

      for (const ti of persisted) {
        const qty = num((ti as any).quantity);
        const sqmVal = num((ti as any).sqm);

        const toBatch: any = (ti as any).itemBatch;
        const destVariant: any = toBatch.itemVariant;
        const parentItem: any = destVariant.thickness.item;

        if (parentItem.type !== 'box' && parentItem.type !== 'sheet') continue;

        const sqmThickness = await manager
          .getRepository(Thickness)
          .createQueryBuilder('th')
          .innerJoin('th.item', 'it', 'it.itemName = :nm AND it.type = :tp', {
            nm: parentItem.itemName,
            tp: 'sqm',
          })
          .where('th.thickness = :val', { val: destVariant.thickness.thickness })
          .getOne();

        if (!sqmThickness) {
          throw new NotFoundException(
            `No sqm thickness ${destVariant.thickness.thickness} for ${parentItem.itemName}`,
          );
        }

        const sqmVariants = await manager.getRepository(ItemVariant).find({
          where: { thickness: { id: (sqmThickness as any).id } as any } as any,
        });

        const sqmVariant = sqmVariants.find(
          (v: any) => v.realDescriptionId !== null && v.realDescriptionId !== undefined,
        );

        if (!sqmVariant) {
          throw new NotFoundException(
            `No sqm variant with realDescriptionId for ${parentItem.itemName}, thickness=${destVariant.thickness.thickness}`,
          );
        }

        const fromBatch = await this.ensureBatch(
          manager,
          (sqmVariant as any).id,
          toBatch.condition,
          toBatch.dateReceived,
        );

        const { prev: prevCosts } = await this.getPrevQtyAndCosts(manager, (sqmVariant as any).id, cut);
        const transferCosts: CostBundle = { ...prevCosts };

        const txOut: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: (sqmVariant as any).id,
          itemBatchId: (fromBatch as any).id,
          transactionType: 'MovedFrom',
          quantity: 0,
          quantityofr: -sqmVal,
          sqm: 0,
          sqmofr: -sqmVal,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txOut, transferCosts);
        this.logIfNaN(txOut, 'STBOS.txOut');
        await manager.getRepository(InventoryTransaction).save(txOut);

        const txIn: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: destVariant.id,
          itemBatchId: toBatch.id,
          transactionType: 'MovedTo',
          quantity: 0,
          quantityofr: qty,
          sqm: 0,
          sqmofr: sqmVal,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txIn, transferCosts);
        this.logIfNaN(txIn, 'STBOS.txIn');
        const savedTxIn = await manager.getRepository(InventoryTransaction).save(txIn);

        // totals
        (fromBatch as any).outOFR = num((fromBatch as any).outOFR) + sqmVal;
        (fromBatch as any).balanceOFR =
          num((fromBatch as any).startOFR) + num((fromBatch as any).inOFR) - num((fromBatch as any).outOFR);
        await manager.getRepository(ItemBatch).save(fromBatch);

        toBatch.inOFR = num(toBatch.inOFR) + sqmVal;
        toBatch.balanceOFR = num(toBatch.startOFR) + num(toBatch.inOFR) - num(toBatch.outOFR);
        await manager.getRepository(ItemBatch).save(toBatch);

        (sqmVariant as any).totalOutOFR = num((sqmVariant as any).totalOutOFR) + sqmVal;
        (sqmVariant as any).totalBalanceOFR =
          num((sqmVariant as any).totalStartOFR) + num((sqmVariant as any).totalInOFR) - num((sqmVariant as any).totalOutOFR);

        destVariant.totalInOFR = num(destVariant.totalInOFR) + sqmVal;
        destVariant.totalBalanceOFR =
          num(destVariant.totalStartOFR) + num(destVariant.totalInOFR) - num(destVariant.totalOutOFR);

        await manager.getRepository(ItemVariant).save([sqmVariant as any, destVariant]);

        const key = Number(destVariant.id);
        const agg = destAgg.get(key) ?? {
          totalSqm: 0,
          weightedCostOfr: 0,
          transferItemIds: [],
          txInIds: [],
          copied: null,
        };

        agg.totalSqm += sqmVal;
        agg.weightedCostOfr += sqmVal * transferCosts.ofr;
        agg.transferItemIds.push((ti as any).id);
        agg.txInIds.push((savedTxIn as any).id);
        rememberCopied(agg, transferCosts);
        destAgg.set(key, agg);
      }

      for (const [destVariantId, agg] of destAgg.entries()) {
        if (agg.totalSqm <= 0) continue;

        const { prevQty, prev: prevCostsDest } = await this.getPrevQtyAndCosts(manager, destVariantId, cut);
        const inCostOfr = agg.weightedCostOfr / agg.totalSqm;
        const newAvgOfr = this.computeNewAvgCost(prevQty, prevCostsDest.ofr, agg.totalSqm, inCostOfr);

        const copied = agg.copied ?? { vm: prevCostsDest.vm, c: prevCostsDest.c, cvm: prevCostsDest.cvm };
        await updateLinesAndTx(destVariantId, agg.transferItemIds, agg.txInIds, newAvgOfr, copied);
      }
    }

    // -----------------------------
    // Breakage / Defects (out only, costs copied from prev event)
    // -----------------------------
    if ((transfer as any).location === 'Breakage' || (transfer as any).location === 'Defects') {
      const cut = this.startOfDay(new Date((transfer as any).date));
      const ttype = (transfer as any).location === 'Defects' ? 'Defects' : 'Breakage';

      for (const ti of persisted) {
        const qty = num((ti as any).quantity);
        const sqmVal = num((ti as any).sqm);

        const batch: any = (ti as any).itemBatch;
        const variant: any = batch.itemVariant;

        const { prev: prevCosts } = await this.getPrevQtyAndCosts(manager, variant.id, cut);

        const txOut: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: variant.id,
          itemBatchId: batch.id,
          transactionType: ttype,
          quantity: 0,
          quantityofr: -qty,
          sqm: 0,
          sqmofr: -sqmVal,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txOut, prevCosts);
        this.logIfNaN(txOut, `${ttype}.txOut`);
        await manager.getRepository(InventoryTransaction).save(txOut);

        batch.outOFR = num(batch.outOFR) + sqmVal;
        batch.balanceOFR = num(batch.startOFR) + num(batch.inOFR) - num(batch.outOFR);
        await manager.getRepository(ItemBatch).save(batch);

        variant.totalOutOFR = num(variant.totalOutOFR) + sqmVal;
        variant.totalBalanceOFR =
          num(variant.totalStartOFR) + num(variant.totalInOFR) - num(variant.totalOutOFR);
        await manager.getRepository(ItemVariant).save(variant);
      }
    }

    // -----------------------------
    // Adjustment + (in)
    // - OFR cost can be provided via ti.price else prev OFR
    // - VM/C/CVM copied from prev event
    // - OFR averageCost updated (weighted); VM/C/CVM copied
    // -----------------------------
    if ((transfer as any).location === 'Adjustment +') {
      const cut = this.startOfDay(new Date((transfer as any).date));
      const adjAgg = new Map<number, Agg>();

      for (const ti of persisted) {
        const qty = num((ti as any).quantity);
        const sqmVal = num((ti as any).sqm);

        const batch: any = (ti as any).itemBatch;
        const variant: any = batch.itemVariant;

        const { prev: prevCosts } = await this.getPrevQtyAndCosts(manager, variant.id, cut);

        const providedOfr = this.maybeNum((ti as any).price);
        const lineOfr = providedOfr != null && providedOfr > 0 ? providedOfr : prevCosts.ofr;

        const lineCosts: CostBundle = {
          ofr: lineOfr,
          vm: prevCosts.vm,
          c: prevCosts.c,
          cvm: prevCosts.cvm,
        };

        const txIn: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: variant.id,
          itemBatchId: batch.id,
          transactionType: 'Adjustment +',
          quantity: 0,
          quantityofr: qty,
          sqm: 0,
          sqmofr: sqmVal,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txIn, lineCosts);
        this.logIfNaN(txIn, 'ADJ+.txIn');
        const saved = await manager.getRepository(InventoryTransaction).save(txIn);

        batch.inOFR = num(batch.inOFR) + sqmVal;
        batch.balanceOFR = num(batch.startOFR) + num(batch.inOFR) - num(batch.outOFR);
        await manager.getRepository(ItemBatch).save(batch);

        variant.totalInOFR = num(variant.totalInOFR) + sqmVal;
        variant.totalBalanceOFR =
          num(variant.totalStartOFR) + num(variant.totalInOFR) - num(variant.totalOutOFR);
        await manager.getRepository(ItemVariant).save(variant);

        const key = Number(variant.id);
        const agg = adjAgg.get(key) ?? {
          totalSqm: 0,
          weightedCostOfr: 0,
          transferItemIds: [],
          txInIds: [],
          copied: null,
        };

        agg.totalSqm += sqmVal;
        agg.weightedCostOfr += sqmVal * lineCosts.ofr;
        agg.transferItemIds.push((ti as any).id);
        agg.txInIds.push((saved as any).id);
        rememberCopied(agg, lineCosts);

        adjAgg.set(key, agg);
      }

      for (const [variantId, agg] of adjAgg.entries()) {
        if (agg.totalSqm <= 0) continue;

        const { prevQty, prev: prevCostsDest } = await this.getPrevQtyAndCosts(manager, variantId, cut);
        const inCostOfr = agg.weightedCostOfr / agg.totalSqm;
        const newAvgOfr = this.computeNewAvgCost(prevQty, prevCostsDest.ofr, agg.totalSqm, inCostOfr);

        const copied = agg.copied ?? { vm: prevCostsDest.vm, c: prevCostsDest.c, cvm: prevCostsDest.cvm };
        await updateLinesAndTx(variantId, agg.transferItemIds, agg.txInIds, newAvgOfr, copied);
      }
    }

    // -----------------------------
    // Adjustment - (out only, costs copied from prev event)
    // -----------------------------
    if ((transfer as any).location === 'Adjustment -') {
      const cut = this.startOfDay(new Date((transfer as any).date));

      for (const ti of persisted) {
        const qty = num((ti as any).quantity);
        const sqmVal = num((ti as any).sqm);

        const batch: any = (ti as any).itemBatch;
        const variant: any = batch.itemVariant;

        const { prev: prevCosts } = await this.getPrevQtyAndCosts(manager, variant.id, cut);

        const txOut: any = manager.getRepository(InventoryTransaction).create({
          itemVariantId: variant.id,
          itemBatchId: batch.id,
          transactionType: 'Adjustment -',
          quantity: 0,
          quantityofr: -qty,
          sqm: 0,
          sqmofr: -sqmVal,
          transferId: (transfer as any).id,
          dateForEachInvoice: new Date((transfer as any).date),
        } as any);
        setTxCosts(txOut, prevCosts);
        this.logIfNaN(txOut, 'ADJ-.txOut');
        await manager.getRepository(InventoryTransaction).save(txOut);

        batch.outOFR = num(batch.outOFR) + sqmVal;
        batch.balanceOFR = num(batch.startOFR) + num(batch.inOFR) - num(batch.outOFR);
        await manager.getRepository(ItemBatch).save(batch);

        variant.totalOutOFR = num(variant.totalOutOFR) + sqmVal;
        variant.totalBalanceOFR =
          num(variant.totalStartOFR) + num(variant.totalInOFR) - num(variant.totalOutOFR);
        await manager.getRepository(ItemVariant).save(variant);
      }
    }
  }
}
