import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';

import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';

import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';

import { TransfersService } from '../transfers/transfers.service';
import { PurchaseInvoiceService } from '../Purchase-invoice/purchase-invoice.service';

import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { InventoryCount } from '../entities/inventory/count.entity';
import { Brackets } from 'typeorm';

type EventRow = {
  type: 'purchase' | 'transfer';
  id: number;
  sortDate: Date;
  sortTs: Date;
  sortId: number;
};

type JobProgress = {
  phase: string;
  current: number;
  total: number;
  message: string;
};

type Job = {
  status: 'running' | 'done' | 'error';
  startedAt: Date;
  finishedAt?: Date;
  result?: any;
  error?: string;
  progress: JobProgress;
  emitter: EventEmitter;
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

  // ─── Job tracking ──────────────────────────────────────────────────────────

  private jobs = new Map<string, Job>();

  startRecomputeJob(fromDate: string): string {
    const jobId = randomUUID();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(20);

    this.jobs.set(jobId, {
      status: 'running',
      startedAt: new Date(),
      emitter,
      progress: { phase: 'scanning', current: 0, total: 0, message: 'Starting...' },
    });

    // Fire and forget — no await
    this.recomputeFromDateWithProgress(fromDate, jobId)
      .then((result) => {
        const job = this.jobs.get(jobId)!;
        job.status = 'done';
        job.finishedAt = new Date();
        job.result = result;
        job.progress = { phase: 'done', current: 1, total: 1, message: 'Complete!' };
        job.emitter.emit('progress', { ...job.progress, status: 'done', result });
        job.emitter.emit('done');
      })
      .catch((err) => {
        const job = this.jobs.get(jobId)!;
        job.status = 'error';
        job.finishedAt = new Date();
        job.error = err?.message || String(err);
        job.emitter.emit('progress', { ...job.progress, status: 'error', message: job.error });
        job.emitter.emit('error', job.error);
      });

    return jobId;
  }

  getJobEmitter(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  getJobStatus(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return { status: 'not_found' };
    const { emitter, ...rest } = job;
    return rest;
  }

  private emitProgress(jobId: string, phase: string, current: number, total: number, message: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.progress = { phase, current, total, message };
    job.emitter.emit('progress', { phase, current, total, message, status: 'running' });
  }

  // ─── Main recompute with progress ─────────────────────────────────────────

  async recomputeFromDateWithProgress(fromDate: string | Date, jobId: string) {
    const from = this.startOfDay(new Date(fromDate));
    if (isNaN(from.getTime())) throw new BadRequestException('Invalid fromDate');

    // Phase 1: scanning
    this.emitProgress(jobId, 'scanning', 0, 1, 'Scanning affected variants...');

    const rawVariantIds = await this.txRepo
      .createQueryBuilder('tx')
      .select('DISTINCT tx.itemVariantId', 'id')
      .where('tx.dateForEachInvoice IS NOT NULL')
      .andWhere('tx.dateForEachInvoice >= :from', { from })
      .andWhere('tx.itemVariantId IS NOT NULL')
      .getRawMany<{ id: string }>();

    const variantIds = rawVariantIds.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
    this.emitProgress(jobId, 'scanning', 1, 1, `Found ${variantIds.length} affected variants`);

    // Phase 2: building timeline
    this.emitProgress(jobId, 'building', 0, 1, 'Building event timeline...');
    const events = await this.buildEvents(from);
    this.emitProgress(jobId, 'building', 1, 1, `Found ${events.length} events to replay`);

    // Phase 3: reset baseline
    this.emitProgress(jobId, 'baseline', 0, 1, 'Resetting baseline costs...');
    await this.resetBaselineCosts(from, variantIds);
    this.emitProgress(jobId, 'baseline', 1, 1, 'Baseline costs reset');

    // Phase 4: replay events
    let purchasesDone = 0;
    let transfersDone = 0;
    const total = events.length;

    for (const ev of events) {
      if (ev.type === 'purchase') {
        await this.recomputeOnePurchaseInvoice(ev.id);
        purchasesDone++;
      } else {
        await this.recomputeOneTransfer(ev.id);
        transfersDone++;
      }
      const done = purchasesDone + transfersDone;
      this.emitProgress(
        jobId, 'replaying', done, total,
        `Replaying events: ${done}/${total} — Purchases: ${purchasesDone}, Transfers: ${transfersDone}`,
      );
    }

    // Phase 5: snapshots
    this.emitProgress(jobId, 'snapshots', 0, 0, 'Counting invoices to snapshot...');
    await this.refreshSalesInvoiceItemAvgSnapshots(from, jobId);

    return {
      from,
      affectedVariants: variantIds.length,
      events: events.length,
      purchasesDone,
      transfersDone,
    };
  }

  // ─── Original recomputeFromDate (kept unchanged) ───────────────────────────

  async recomputeFromDate(fromDate: string | Date) {
    const from = this.startOfDay(new Date(fromDate));
    if (isNaN(from.getTime())) throw new BadRequestException('Invalid fromDate');

    const rawVariantIds = await this.txRepo
      .createQueryBuilder('tx')
      .select('DISTINCT tx.itemVariantId', 'id')
      .where('tx.dateForEachInvoice IS NOT NULL')
      .andWhere('tx.dateForEachInvoice >= :from', { from })
      .andWhere('tx.itemVariantId IS NOT NULL')
      .getRawMany<{ id: string }>();

    const variantIds = rawVariantIds.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
    const events = await this.buildEvents(from);
    await this.resetBaselineCosts(from, variantIds);

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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private num(v: any, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // ─── refreshSalesInvoiceItemAvgSnapshots (unchanged) ──────────────────────

  private async refreshSalesInvoiceItemAvgSnapshots(from: Date, jobId?: string) {
    const TAG = `[RECOMP-SALES-SNAPSHOT]`;

    const invoiceIdsRaw = await this.salesInvoiceRepo
      .createQueryBuilder('inv')
      .select('inv.id', 'id')
      .where('inv.date >= :from', { from })
      .andWhere('inv.invoiceType IN (:...types)', { types: ['S', 'G', 'RVR'] })
      .getRawMany<{ id: string }>();

    const invoiceIds = invoiceIdsRaw.map((r) => Number(r.id)).filter(Number.isFinite);

    console.log(`${TAG} invoices to refresh:`, invoiceIds.length);
    if (!invoiceIds.length) return;

    if (jobId) this.emitProgress(jobId, 'snapshots', 0, invoiceIds.length, `Refreshing snapshots for ${invoiceIds.length} invoices...`);

    const CHUNK = 200;

    const toNumOrNull = (v: any): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const safeAvgOrNull = (sumVal: number, sumQty: number) => {
      if (!Number.isFinite(sumVal) || !Number.isFinite(sumQty) || sumQty <= 0) return null;
      return sumVal / sumQty;
    };

    // Converts a MySQL DATE (may come back as a JS Date object) to 'YYYY-MM-DD'
    const toYMD = (d: any): string => {
      if (!d) return '';
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d).slice(0, 10);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dt.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

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

      for (let hop = 0; hop < 6 && last?.transferId; hop++) {
        const tid = Number((last as any).transferId);
        const txType = String((last as any).transactionType || '');
        const transfer = await this.transferRepo.findOne({
          where: { id: tid } as any,
          select: ['id', 'location'] as any,
        });

        const loc = String((transfer as any)?.location || '').toUpperCase();
        const isSpecial = loc === 'JF' || loc === 'FJ' || loc === 'BOSTS';

        if (isSpecial && txType === 'MovedFrom') {
          const lastId = Number((last as any).id);
          const lastDate = toYMD((last as any).dateForEachInvoice);

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
                b.where('tx.dateForEachInvoice < :d', { d: lastDate }).orWhere(
                  new Brackets((b2) => {
                    b2.where('tx.dateForEachInvoice = :d', { d: lastDate }).andWhere('tx.id < :id', { id: lastId });
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

    const getTransferCostBundle = async (variantId: number, lastTx: any) => {
      const transferId = Number(lastTx.transferId);
      const txType = String(lastTx.transactionType || '');
      const cutDate = toYMD(lastTx.dateForEachInvoice);

      const transfer = await this.transferRepo.findOne({
        where: { id: transferId } as any,
        select: ['id', 'location'] as any,
      });

      const loc = String((transfer as any)?.location || '').toUpperCase();
      const isSpecial = loc === 'JF' || loc === 'FJ' || loc === 'BOSTS';

      let costBatchId: number | null = lastTx.itemBatchId != null ? Number(lastTx.itemBatchId) : null;

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
        return { averageCost: null, averageCostVM: null, averageCostC: null, averageCostCVM: null };
      }

      const ti = await this.transferItemRepo.findOne({
        where: { transferId, itemBatchId: costBatchId } as any,
        order: { id: 'DESC' } as any,
      });

      if (!ti) {
        return { averageCost: null, averageCostVM: null, averageCostC: null, averageCostCVM: null };
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

        const cache = new Map<number, {
          averageCost: number | null;
          averageCostVM: number | null;
          averageCostC: number | null;
          averageCostCVM: number | null;
        }>();

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
              bundle.averageCost = toNumOrNull((ic as any).finalCostOfr);
              bundle.averageCostVM = toNumOrNull((ic as any).finalCost);

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

                  bundle.averageCostC = safeAvgOrNull(Number(raw?.sumValOfr ?? 0), Number(raw?.sumQtyOfr ?? 0));
                  bundle.averageCostCVM = safeAvgOrNull(Number(raw?.sumValVm ?? 0), Number(raw?.sumQtyVm ?? 0));
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
          it.lastCost = null;
          it.lastCostVM = null;
          it.lastCostC = null;
          it.lastCostCVM = null;
        }

        await this.salesInvoiceItemRepo.save(items as any);
      }

      const doneCount = Math.min(i + CHUNK, invoiceIds.length);
      console.log(`${TAG} processed chunk`, { i, batch: batchIds.length });
      if (jobId) this.emitProgress(jobId, 'snapshots', doneCount, invoiceIds.length, `Snapshots: ${doneCount} / ${invoiceIds.length} invoices`);
    }

    console.log(`${TAG} DONE`);
    if (jobId) this.emitProgress(jobId, 'snapshots', invoiceIds.length, invoiceIds.length, `Snapshots complete — ${invoiceIds.length} invoices refreshed`);
  }

  // ─── buildEvents (unchanged) ───────────────────────────────────────────────

  private async buildEvents(from: Date): Promise<EventRow[]> {
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

  // ─── resetBaselineCosts (unchanged) ───────────────────────────────────────

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

        const prevRes = await (this.transfersService as any).getPrevQtyAndCosts(manager, vid, from);
        const prev = prevRes?.prev ?? { ofr: 0, vm: 0, c: 0, cvm: 0 };

        await manager.getRepository(ItemVariant).update(
          { id: vid } as any,
          { averageCost: this.num(prev.ofr), averageCostVM: this.num(prev.vm) } as any,
        );

        const descId = v.itemNameDescriptionId != null ? Number(v.itemNameDescriptionId) : null;
        if (descId && !descDone.has(descId)) {
          await manager.getRepository(ItemNameDescription).update(
            { id: descId } as any,
            { averageCostC: this.num(prev.c), averageCostCVM: this.num(prev.cvm) } as any,
          );
          descDone.add(descId);
        }
      }
    });
  }

  // ─── recomputeOnePurchaseInvoice (unchanged) ───────────────────────────────

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

    if (piiIds.length) {
      await this.txRepo.delete({ purchaseInvoiceItemId: In(piiIds) } as any);
    }

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
          sqmOfr = Number((item as any).sqmOfr ?? 0);
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
        where: { itemVariant: { id: item.itemVariantId }, condition, dateReceived } as any,
        relations: ['itemVariant'] as any,
      });

      if (!itemBatch) {
        const newBatch = this.batchRepo.create();
        Object.assign(newBatch as any, {
          itemVariant: { id: item.itemVariantId } as any,
          condition,
          dateReceived: null,
          start: 0, in: 0, out: 0, balance: 0,
          startOFR: 0, inOFR: 0, outOFR: 0, balanceOFR: 0,
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

    const allBatchIds = new Set<number>([...affectedBatchIds, ...newBatchIds]);

    await (this.purchaseService as any).rebuildInventoryForPurchaseInvoice(
      { ...(invoice as any), items } as any,
      Array.from(allBatchIds),
    );

    await (this.purchaseService as any).computeAndWriteCostsForInvoice(invoiceId);
  }

  // ─── recomputeOneTransfer (unchanged) ─────────────────────────────────────

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

      await (this.transfersService as any).rollbackTransfer(manager, transferId, { keepItems: true });

      const reloaded = await (this.transfersService as any).mustGetTransfer(manager, transferId);

      const itemsPayload = ((reloaded as any).items ?? []).map((ti: any) => ({
        id: ti.id,
        itemBatchId: ti.itemBatchId,
        quantity: Number(ti.quantity ?? 0),
        sqm: Number(ti.sqm ?? 0),
        price: ti.price ?? null,
        averageCost: ti.averageCost ?? null,
        averageCostVM: ti.averageCostVM ?? null,
        averageCostC: ti.averageCostC ?? null,
        averageCostCVM: ti.averageCostCVM ?? null,
        toItemVariantId: ti.toItemVariantId ?? null,
        invoiceItemId: ti.invoiceItemId ?? null,
      }));

      await (this.transfersService as any).applyTransferLogic(manager, reloaded, itemsPayload);
    });
  }
}