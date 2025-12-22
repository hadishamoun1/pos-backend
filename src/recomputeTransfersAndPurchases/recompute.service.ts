import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemNameDescription } from 'src/entities/inventory/itemNameDescription.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';

import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';

import { PurchaseInvoice } from 'src/entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from 'src/entities/Purchase-Invoice/purchase-invoice-item.entity';

import { TransfersService } from '../transfers/transfers.service';
import { PurchaseInvoiceService } from 'src/Purchase-invoice/purchase-invoice.service';

type EventRow = {
  type: 'purchase' | 'transfer';
  id: number;
  sortDate: Date;
  sortTs: Date;
  sortId: number;
};

@Injectable()
export class RecomputeCostsService {
  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(InventoryTransaction)
    private readonly txRepo: Repository<InventoryTransaction>,

    @InjectRepository(ItemVariant)
    private readonly variantRepo: Repository<ItemVariant>,

    @InjectRepository(ItemNameDescription)
    private readonly descRepo: Repository<ItemNameDescription>,

    @InjectRepository(ItemBatch)
    private readonly batchRepo: Repository<ItemBatch>,

    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,

    @InjectRepository(TransferItem)
    private readonly transferItemRepo: Repository<TransferItem>,

    @InjectRepository(PurchaseInvoice)
    private readonly purchaseRepo: Repository<PurchaseInvoice>,

    @InjectRepository(PurchaseInvoiceItem)
    private readonly purchaseItemRepo: Repository<PurchaseInvoiceItem>,

    private readonly transfersService: TransfersService,
    private readonly purchaseService: PurchaseInvoiceService,
  ) {}

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private num(v: any, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Main entry
   * - fromDate can be "2025-12-01" or Date
   */
  async recomputeFromDate(fromDate: string | Date) {
    const from = this.startOfDay(new Date(fromDate));
    if (isNaN(from.getTime())) throw new BadRequestException('Invalid fromDate');

    // 1) build list of affected variant ids (anything with tx on/after from)
    const rawVariantIds = await this.txRepo
      .createQueryBuilder('tx')
      .select('DISTINCT tx.itemVariantId', 'id')
      .where('tx.dateForEachInvoice IS NOT NULL')
      .andWhere('tx.dateForEachInvoice >= :from', { from })
      .andWhere('tx.itemVariantId IS NOT NULL')
      .getRawMany<{ id: string }>();

    const variantIds = rawVariantIds.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));

    // 2) build ordered events list
    const events = await this.buildEvents(from);

    // 3) reset baseline costs as-of start date (IMPORTANT)
    await this.resetBaselineCosts(from, variantIds);

    // 4) replay events in order
    let purchasesDone = 0;
    let transfersDone = 0;

    for (const ev of events) {
      if (ev.type === 'purchase') {
        await this.recomputeOnePurchaseInvoice(ev.id);
        purchasesDone++;
      } else {
        await this.recomputeOneTransfer(ev.id);
        transfersDone++;
      }
    }

    return {
      from,
      affectedVariants: variantIds.length,
      events: events.length,
      purchasesDone,
      transfersDone,
    };
  }

  private async buildEvents(from: Date): Promise<EventRow[]> {
    // Transfers
    const rawTransfers = await this.txRepo
      .createQueryBuilder('tx')
      .select('tx.transferId', 'id')
      .addSelect('MIN(tx.dateForEachInvoice)', 'sortDate')
      .addSelect('MIN(tx.transactionDate)', 'sortTs')
      .addSelect('MIN(tx.id)', 'sortId')
      .where('tx.dateForEachInvoice IS NOT NULL')
      .andWhere('tx.dateForEachInvoice >= :from', { from })
      .andWhere('tx.transferId IS NOT NULL')
      .groupBy('tx.transferId')
      .getRawMany<{ id: string; sortDate: any; sortTs: any; sortId: any }>();

    // Purchases (group by invoice through purchaseInvoiceItem)
    const rawPurchases = await this.txRepo
      .createQueryBuilder('tx')
      .innerJoin('tx.purchaseInvoiceItem', 'pii')
      .innerJoin('pii.invoice', 'inv')
      .select('inv.id', 'id')
      .addSelect('MIN(tx.dateForEachInvoice)', 'sortDate')
      .addSelect('MIN(tx.transactionDate)', 'sortTs')
      .addSelect('MIN(tx.id)', 'sortId')
      .where('tx.dateForEachInvoice IS NOT NULL')
      .andWhere('tx.dateForEachInvoice >= :from', { from })
      .andWhere('tx.purchaseInvoiceItemId IS NOT NULL')
      .andWhere('inv.status = :st', { st: 'Recieved' })
      .groupBy('inv.id')
      .getRawMany<{ id: string; sortDate: any; sortTs: any; sortId: any }>();

    const out: EventRow[] = [];

    for (const r of rawPurchases) {
      out.push({
        type: 'purchase',
        id: Number(r.id),
        sortDate: new Date(r.sortDate),
        sortTs: new Date(r.sortTs),
        sortId: Number(r.sortId),
      });
    }

    for (const r of rawTransfers) {
      out.push({
        type: 'transfer',
        id: Number(r.id),
        sortDate: new Date(r.sortDate),
        sortTs: new Date(r.sortTs),
        sortId: Number(r.sortId),
      });
    }

    out.sort((a, b) => {
      const d = a.sortDate.getTime() - b.sortDate.getTime();
      if (d !== 0) return d;
      const t = a.sortTs.getTime() - b.sortTs.getTime();
      if (t !== 0) return t;
      if (a.type !== b.type) return a.type === 'purchase' ? -1 : 1;
      return a.sortId - b.sortId;
    });

    return out;
  }

  /**
   * Reset ItemVariant + ItemNameDescription averages to the state right BEFORE `from`.
   * Uses your transfer service's getPrevQtyAndCosts() (private) via (as any).
   */
  private async resetBaselineCosts(from: Date, variantIds: number[]) {
    if (!variantIds.length) return;

    await this.dataSource.transaction(async (manager) => {
      const variants = await manager.getRepository(ItemVariant).find({
        where: { id: In(variantIds) } as any,
        select: ['id', 'itemNameDescriptionId'] as any,
      });

      const descDone = new Set<number>();

      for (const v of variants as any[]) {
        const vid = Number(v.id);
        if (!Number.isFinite(vid)) continue;

        const prevRes = await (this.transfersService as any).getPrevQtyAndCosts(
          manager,
          vid,
          from,
        );

        const prev = prevRes?.prev ?? { ofr: 0, vm: 0, c: 0, cvm: 0 };

        await manager.getRepository(ItemVariant).update(
          { id: vid } as any,
          {
            averageCost: this.num(prev.ofr),
            averageCostVM: this.num(prev.vm),
          } as any,
        );

        const descId = v.itemNameDescriptionId != null ? Number(v.itemNameDescriptionId) : null;
        if (descId && !descDone.has(descId)) {
          await manager.getRepository(ItemNameDescription).update(
            { id: descId } as any,
            {
              averageCostC: this.num(prev.c),
              averageCostCVM: this.num(prev.cvm),
            } as any,
          );
          descDone.add(descId);
        }
      }
    });
  }

  /**
   * Purchase recompute:
   * - delete tx rows linked to this invoice's items
   * - recreate tx rows from invoice items (same logic)
   * - call rebuildInventoryForPurchaseInvoice + computeAndWriteCostsForInvoice (private) via (as any)
   */
  private async recomputeOnePurchaseInvoice(invoiceId: number) {
    const invoice = await this.purchaseRepo.findOne({
      where: { id: invoiceId } as any,
      relations: ['items', 'items.itemVariant'] as any,
    });

    if (!invoice) throw new NotFoundException(`Purchase invoice ${invoiceId} not found`);
    if ((invoice as any).status !== 'Recieved') return;

    const invoiceDate = new Date((invoice as any).date);
    const items = ((invoice as any).items ?? []) as PurchaseInvoiceItem[];
    const piiIds = items.map((x: any) => Number(x.id)).filter((x) => Number.isFinite(x));

    // collect old batch ids
    const oldTxs = piiIds.length
      ? await this.txRepo.find({
          where: { purchaseInvoiceItemId: In(piiIds) } as any,
          select: ['id', 'itemBatchId'] as any,
        })
      : [];

    const affectedBatchIds = new Set<number>();
    for (const t of oldTxs as any[]) {
      if (t.itemBatchId != null) affectedBatchIds.add(Number(t.itemBatchId));
    }

    // delete old purchase tx rows for this invoice
    if (piiIds.length) {
      await this.txRepo.delete({ purchaseInvoiceItemId: In(piiIds) } as any);
    }

    // recreate tx rows from invoice items
    const invTxs: InventoryTransaction[] = [];
    const newBatchIds = new Set<number>();

    for (const item of items as any[]) {
      let qty = this.num(item.quantity, 0);
      let sqm = this.num(item.sqm, 0);
      let qtyOfr = 0;
      let sqmOfr = 0;

      switch ((invoice as any).type) {
        case 'S':
        case 'SR':
          qtyOfr = qty;
          sqmOfr = sqm;
          break;
        case 'G':
          qtyOfr = qty;
          sqmOfr =  Number((item as any).sqmOfr ?? 0);
          qty = 0;
          sqm = 0;
          break;
        case 'RVR':
          qtyOfr = 0;
          sqmOfr = 0;
          break;
        default:
          qtyOfr = qty;
          sqmOfr = sqm;
      }

      const condition = item.condition || 'Clean';
      const dateReceived = null;

      let itemBatch: ItemBatch | null = await this.batchRepo.findOne({
        where: {
          itemVariant: { id: item.itemVariantId },
          condition,
          dateReceived,
        } as any,
        relations: ['itemVariant'] as any,
      });

      if (!itemBatch) {
        const newBatch = this.batchRepo.create();
        Object.assign(newBatch as any, {
          itemVariant: { id: item.itemVariantId } as any,
          condition,
          dateReceived: null,
          start: 0,
          in: 0,
          out: 0,
          balance: 0,
          startOFR: 0,
          inOFR: 0,
          outOFR: 0,
          balanceOFR: 0,
        });
        itemBatch = await this.batchRepo.save(newBatch as any);
      }

      newBatchIds.add(Number((itemBatch as any).id));

      const tx = this.txRepo.create({
        itemVariantId: item.itemVariantId,
        itemBatchId: (itemBatch as any).id,
        transactionType: 'purchase',
        quantity: qty,
        sqm: sqm,
        quantityofr: qtyOfr,
        sqmofr: sqmOfr,
        finalcost: Number(item.finalCost ?? 0),
        finalcostofr: Number(item.finalOFR ?? item.finalCostOfr ?? 0),
        purchaseInvoiceItemId: item.id,
        invoiceItemId: null,
        transferId: null,
        inventoryCountId: null,
        transactionDate: invoiceDate,
        dateForEachInvoice: invoiceDate,
      } as any);

      invTxs.push(tx as any);
    }

    if (invTxs.length) await this.txRepo.save(invTxs as any);

    // rebuild batches + variant totals (your existing behavior)
    const allBatchIds = new Set<number>([...affectedBatchIds, ...newBatchIds]);

    await (this.purchaseService as any).rebuildInventoryForPurchaseInvoice(
      { ...(invoice as any), items } as any,
      Array.from(allBatchIds),
    );

    // compute averages ONLY for this invoice (your function)
    await (this.purchaseService as any).computeAndWriteCostsForInvoice(invoiceId);
  }

  /**
   * Transfer recompute:
   * - do rollback + re-apply inside ONE transaction
   * - uses TransfersService private helpers via (as any)
   * - no websocket spam (we do not call the public update)
   */
  private async recomputeOneTransfer(transferId: number) {
    const transferExists = await this.transferRepo.findOne({
      where: { id: transferId } as any,
      select: ['id'] as any,
    });
    if (!transferExists) throw new NotFoundException(`Transfer ${transferId} not found`);

    await this.dataSource.transaction(async (manager) => {
      // snapshot header + items (plain)
      const header = await manager.getRepository(Transfer).findOne({
        where: { id: transferId } as any,
      });
      if (!header) throw new NotFoundException(`Transfer ${transferId} not found`);

      const items = await manager.getRepository(TransferItem).find({
        where: { transferId } as any,
      });

      const itemsPayload = (items as any[]).map((ti) => ({
        itemBatchId: ti.itemBatchId ?? (ti as any).itemBatch?.id,
        toItemVariantId: (ti as any).toItemVariantId ?? (ti as any).itemVariantId,
        quantity: (ti as any).quantity,
        sqm: (ti as any).sqm,
        price: (ti as any).price,
        transactionType: (ti as any).transactionType,
        reason: (ti as any).reason,
        condition: (ti as any).condition,
      }));

      // rollback existing effect
      await (this.transfersService as any).rollbackTransfer(manager, transferId);

      // restore header as-is (keeps same id/number/date/type/location)
      await manager.getRepository(Transfer).update(
        { id: transferId } as any,
        {
          transferNumber: (header as any).transferNumber,
          date: (header as any).date,
          type: (header as any).type,
          location: (header as any).location,
        } as any,
      );

      // re-insert items
      await (this.transfersService as any).insertTransferItems(
        manager,
        transferId,
        itemsPayload,
      );

      // reload full transfer (their helper expects relations)
      const reloaded = await (this.transfersService as any).mustGetTransfer(manager, transferId);

      // re-apply inventory/cost logic
      await (this.transfersService as any).applyTransferLogic(
        manager,
        reloaded,
        itemsPayload,
      );
    });
  }
}
