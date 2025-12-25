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

import { Invoice } from 'src/entities/invoice.entity';
import { InvoiceItem } from 'src/entities/invoiceItem.entity';
import { InventoryCount } from 'src/entities/inventory/count.entity'; 
import { Brackets } from 'typeorm';


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

    @InjectRepository(Invoice)
private readonly salesInvoiceRepo: Repository<Invoice>,

@InjectRepository(InvoiceItem)
private readonly salesInvoiceItemRepo: Repository<InvoiceItem>,

@InjectRepository(InventoryCount)
private readonly countRepo: Repository<InventoryCount>,


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
    await this.refreshSalesInvoiceItemAvgSnapshots(from);


    return {
      from,
      affectedVariants: variantIds.length,
      events: events.length,
      purchasesDone,
      transfersDone,
    };
  }



private async refreshSalesInvoiceItemAvgSnapshots(from: Date) {
  const TAG = `[RECOMP-SALES-SNAPSHOT]`;

  // Fetch all sales invoices from "from" date
  const invoiceIdsRaw = await this.salesInvoiceRepo
    .createQueryBuilder('inv')
    .select('inv.id', 'id')
    .where('inv.date >= :from', { from })
    .andWhere('inv.invoiceType IN (:...types)', { types: ['S', 'G', 'RVR'] })
    .getRawMany<{ id: string }>();

  const invoiceIds = invoiceIdsRaw.map((r) => Number(r.id)).filter(Number.isFinite);

  console.log(`${TAG} invoices to refresh:`, invoiceIds.length);
  if (!invoiceIds.length) return;

  const CHUNK = 200;

  const toNumOrNull = (v: any): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const safeAvgOrNull = (sumVal: number, sumQty: number) => {
    if (!Number.isFinite(sumVal) || !Number.isFinite(sumQty) || sumQty <= 0) return null;
    return sumVal / sumQty;
  };

  // helper: fetch last tx, with the ability to skip “source side” of special transfers
  const getLastCostEventTx = async (variantId: number, cutStr: string) => {
    let last = await this.txRepo
      .createQueryBuilder('tx')
      .where('tx.itemVariantId = :variantId', { variantId })
      .andWhere('tx.dateForEachInvoice <= :cut', { cut: cutStr })
      .andWhere(
        new Brackets((b) => {
          b.where('tx.purchaseInvoiceItemId IS NOT NULL')
            .orWhere('tx.transferId IS NOT NULL')
            .orWhere('tx.inventoryCountId IS NOT NULL');
        }),
      )
      .orderBy('tx.dateForEachInvoice', 'DESC')
      .addOrderBy('tx.id', 'DESC')
      .getOne();

    // Skip loop (max a few hops, prevents infinite loop)
    for (let hop = 0; hop < 6 && last?.transferId; hop++) {
      const tid = Number((last as any).transferId);
      const txType = String((last as any).transactionType || '');
      const transfer = await this.transferRepo.findOne({
        where: { id: tid } as any,
        select: ['id', 'location'] as any,
      });

      const loc = String((transfer as any)?.location || '').toUpperCase();

      const isSpecial = loc === 'JF' || loc === 'FJ' || loc === 'BOSTS';

      // ✅ For special transfers: ignore the SOURCE side (MovedFrom) as a “cost event”
      if (isSpecial && txType === 'MovedFrom') {
        const lastId = Number((last as any).id);
        const lastDate = String((last as any).dateForEachInvoice);

        last = await this.txRepo
          .createQueryBuilder('tx')
          .where('tx.itemVariantId = :variantId', { variantId })
          .andWhere('tx.dateForEachInvoice <= :cut', { cut: cutStr })
          .andWhere(
            new Brackets((b) => {
              b.where('tx.purchaseInvoiceItemId IS NOT NULL')
                .orWhere('tx.transferId IS NOT NULL')
                .orWhere('tx.inventoryCountId IS NOT NULL');
            }),
          )
          .andWhere(
            new Brackets((b) => {
              // strictly earlier than the “skipped” one
              b.where('tx.dateForEachInvoice < :d', { d: lastDate }).orWhere(
                new Brackets((b2) => {
                  b2.where('tx.dateForEachInvoice = :d', { d: lastDate }).andWhere('tx.id < :id', {
                    id: lastId,
                  });
                }),
              );
            }),
          )
          .orderBy('tx.dateForEachInvoice', 'DESC')
          .addOrderBy('tx.id', 'DESC')
          .getOne();

        continue;
      }

      break;
    }

    return last;
  };

  // helper: find the transferItem row that holds the costs we need
  const getTransferCostBundle = async (variantId: number, lastTx: any) => {
    const transferId = Number(lastTx.transferId);
    const txType = String(lastTx.transactionType || '');
    const cutDate = String(lastTx.dateForEachInvoice);

    const transfer = await this.transferRepo.findOne({
      where: { id: transferId } as any,
      select: ['id', 'location'] as any,
    });

    const loc = String((transfer as any)?.location || '').toUpperCase();
    const isSpecial = loc === 'JF' || loc === 'FJ' || loc === 'BOSTS';

    // default: use tx’s own batch
    let costBatchId: number | null = lastTx.itemBatchId != null ? Number(lastTx.itemBatchId) : null;

    // ✅ For special transfers, if we are on the DEST side (MovedTo),
    // the transferItem row is tied to the SOURCE batch (MovedFrom).
    if (isSpecial && txType === 'MovedTo') {
      const sqmofr = Number(lastTx.sqmofr ?? 0);
      const sqm = Number(lastTx.sqm ?? 0);
      const qofr = Number(lastTx.quantityofr ?? 0);
      const q = Number(lastTx.quantity ?? 0);

      const pairedOut = await this.txRepo
        .createQueryBuilder('tx')
        .where('tx.transferId = :tid', { tid: transferId })
        .andWhere('tx.transactionType = :t', { t: 'MovedFrom' })
        .andWhere('tx.dateForEachInvoice = :d', { d: cutDate })
        .andWhere(
          new Brackets((b) => {
            // try to match the paired line by magnitude
            b.where('ABS(COALESCE(tx.sqmofr,0)) = ABS(:sqmofr)', { sqmofr })
              .orWhere('ABS(COALESCE(tx.sqm,0)) = ABS(:sqm)', { sqm })
              .orWhere('ABS(COALESCE(tx.quantityofr,0)) = ABS(:qofr)', { qofr })
              .orWhere('ABS(COALESCE(tx.quantity,0)) = ABS(:q)', { q });
          }),
        )
        .orderBy('tx.id', 'DESC')
        .getOne();

      if (pairedOut?.itemBatchId != null) {
        costBatchId = Number(pairedOut.itemBatchId);
      } else {
        // fallback: any movedFrom in the same transfer/date
        const anyOut = await this.txRepo.findOne({
          where: {
            transferId,
            transactionType: 'MovedFrom' as any,
            dateForEachInvoice: cutDate as any,
          } as any,
          order: { id: 'DESC' } as any,
        });

        if ((anyOut as any)?.itemBatchId != null) {
          costBatchId = Number((anyOut as any).itemBatchId);
        }
      }
    }

    if (!costBatchId) {
      return {
        averageCost: null,
        averageCostVM: null,
        averageCostC: null,
        averageCostCVM: null,
      };
    }

    // ✅ IMPORTANT: we do NOT use itemVariantId at all (it’s null in your table)
    const ti = await this.transferItemRepo.findOne({
      where: {
        transferId,
        itemBatchId: costBatchId,
      } as any,
      order: { id: 'DESC' } as any,
    });

    if (!ti) {
      return {
        averageCost: null,
        averageCostVM: null,
        averageCostC: null,
        averageCostCVM: null,
      };
    }

    return {
      averageCost: toNumOrNull((ti as any).averageCost),
      averageCostVM: toNumOrNull((ti as any).averageCostVM),
      averageCostC: toNumOrNull((ti as any).averageCostC),
      averageCostCVM: toNumOrNull((ti as any).averageCostCVM),
    };
  };

  for (let i = 0; i < invoiceIds.length; i += CHUNK) {
    const batchIds = invoiceIds.slice(i, i + CHUNK);

    const invoices = await this.salesInvoiceRepo.find({
      where: { id: In(batchIds) } as any,
      relations: ['items'] as any,
    });

    for (const inv of invoices as any[]) {
      const invDate = new Date(inv.date);
      const cutStr = invDate.toISOString().slice(0, 10);

      const items: InvoiceItem[] = (inv.items ?? []).filter((x: any) => x?.itemVariantId);
      if (!items.length) continue;

      const uniqVariantIds = Array.from(
        new Set(items.map((it: any) => Number(it.itemVariantId)).filter(Boolean)),
      );

      const cache = new Map<
        number,
        {
          averageCost: number | null;
          averageCostVM: number | null;
          averageCostC: number | null;
          averageCostCVM: number | null;
        }
      >();

      for (const variantId of uniqVariantIds) {
        const lastTx = await getLastCostEventTx(variantId, cutStr);

        let bundle = {
          averageCost: null as number | null,
          averageCostVM: null as number | null,
          averageCostC: null as number | null,
          averageCostCVM: null as number | null,
        };

        if ((lastTx as any)?.purchaseInvoiceItemId) {
          const pii = await this.purchaseItemRepo.findOne({
            where: { id: Number((lastTx as any).purchaseInvoiceItemId) } as any,
          });

          if (pii) {
            bundle = {
              averageCost: toNumOrNull((pii as any).averageCost),
              averageCostVM: toNumOrNull((pii as any).averageCostVM),
              averageCostC: toNumOrNull((pii as any).averageCostC),
              averageCostCVM: toNumOrNull((pii as any).averageCostCVM),
            };
          }
        } else if ((lastTx as any)?.transferId) {
          bundle = await getTransferCostBundle(variantId, lastTx as any);
        } else if ((lastTx as any)?.inventoryCountId) {
          const ic = await this.countRepo.findOne({
            where: { id: Number((lastTx as any).inventoryCountId) } as any,
          });

          if (ic) {
            // your rule:
            // finalCostOfr -> averageCost
            // finalCost    -> averageCostVM
            bundle.averageCost = toNumOrNull((ic as any).finalCostOfr);
            bundle.averageCostVM = toNumOrNull((ic as any).finalCost);

            // derive C / CVM from counts (desc weighted avg) up to invoice date
            const v = await this.variantRepo.findOne({
              where: { id: variantId } as any,
              select: ['id', 'itemNameDescriptionId'] as any,
            });

            const descId = Number((v as any)?.itemNameDescriptionId || 0);

            if (descId) {
              const descVariantRows = await this.variantRepo
                .createQueryBuilder('v')
                .select(['v.id AS id'])
                .where('v.itemNameDescriptionId = :d', { d: descId })
                .getRawMany();

              const descVariantIds = Array.from(
                new Set((descVariantRows || []).map((r: any) => Number(r.id)).filter(Boolean)),
              );

              if (descVariantIds.length) {
                const raw = await this.countRepo
                  .createQueryBuilder('ic')
                  .select('SUM(COALESCE(ic.sqmOfr,0))', 'sumQtyOfr')
                  .addSelect('SUM(COALESCE(ic.sqmOfr,0) * COALESCE(ic.finalCostOfr,0))', 'sumValOfr')
                  .addSelect('SUM(COALESCE(ic.sqm,0))', 'sumQtyVm')
                  .addSelect('SUM(COALESCE(ic.sqm,0) * COALESCE(ic.finalCost,0))', 'sumValVm')
                  .where('ic.itemVariantId IN (:...ids)', { ids: descVariantIds })
                  .andWhere('ic.date <= :cut', { cut: cutStr })
                  .getRawOne<any>();

                const sumQtyOfr = Number(raw?.sumQtyOfr ?? 0);
                const sumValOfr = Number(raw?.sumValOfr ?? 0);
                const sumQtyVm = Number(raw?.sumQtyVm ?? 0);
                const sumValVm = Number(raw?.sumValVm ?? 0);

                bundle.averageCostC = safeAvgOrNull(sumValOfr, sumQtyOfr);
                bundle.averageCostCVM = safeAvgOrNull(sumValVm, sumQtyVm);
              }
            }
          }
        }

        cache.set(variantId, bundle);
      }

      for (const it of items as any[]) {
        const b = cache.get(Number(it.itemVariantId));
        if (!b) continue;

        it.averageCost = b.averageCost;
        it.averageCostVM = b.averageCostVM;
        it.averageCostC = b.averageCostC;
        it.averageCostCVM = b.averageCostCVM;

        // keep lastCost* empty (you don’t want them)
        it.lastCost = null;
        it.lastCostVM = null;
        it.lastCostC = null;
        it.lastCostCVM = null;
      }

      await this.salesInvoiceItemRepo.save(items as any);
    }

    console.log(`${TAG} processed chunk`, { i, batch: batchIds.length });
  }

  console.log(`${TAG} DONE`);
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
    const header = await manager.getRepository(Transfer).findOne({
      where: { id: transferId } as any,
    });
    if (!header) throw new NotFoundException(`Transfer ${transferId} not found`);

    const items = await manager.getRepository(TransferItem).find({
      where: { transferId } as any,
    });

    // ✅ include avg fields so recompute doesn't wipe them
    const itemsPayload = (items as any[]).map((ti) => ({
      itemBatchId: ti.itemBatchId ?? null,
      itemVariantId: (ti as any).itemVariantId ?? null,

      quantity: Number((ti as any).quantity ?? 0),
      sqm: Number((ti as any).sqm ?? 0),
      price: (ti as any).price ?? null,

      transactionType: (ti as any).transactionType,
      reason: (ti as any).reason,
      condition: (ti as any).condition,

      averageCost: (ti as any).averageCost ?? null,
      averageCostVM: (ti as any).averageCostVM ?? null,
      averageCostC: (ti as any).averageCostC ?? null,
      averageCostCVM: (ti as any).averageCostCVM ?? null,
    }));

    // rollback + rebuild
    await (this.transfersService as any).rollbackTransfer(manager, transferId);

    await manager.getRepository(Transfer).update(
      { id: transferId } as any,
      {
        transferNumber: (header as any).transferNumber,
        date: (header as any).date,
        type: (header as any).type,
        location: (header as any).location,
      } as any,
    );

    await (this.transfersService as any).insertTransferItems(manager, transferId, itemsPayload);

    const reloaded = await (this.transfersService as any).mustGetTransfer(manager, transferId);

    await (this.transfersService as any).applyTransferLogic(manager, reloaded, itemsPayload);
  });
}

}
