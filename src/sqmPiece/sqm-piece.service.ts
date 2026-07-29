// src/sqm-pieces/sqm-pieces.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SqmPiece } from '../entities/inventory/SqmPiece.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { Transfer } from '../entities/inventory/transfer.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class SqmPiecesService {
  constructor(
    @InjectRepository(SqmPiece)
    private readonly sqmPieceRepo: Repository<SqmPiece>,

    @InjectRepository(TransferItem)
    private readonly transferItemRepo: Repository<TransferItem>,

    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,

  ) {}

  /**
   * List all BOSTS transfer lines that created sqm,
   * including how much is allocated to pieces, sold, trashed,
   * and how much is still available.
   *
   * NOW:
   *  - Groups by (thickness + itemName) on the backend
   *  - Supports search `q`
   *  - Paginates by groups
   */
  async listBostsLines(opts?: { page?: number; limit?: number; q?: string }) {
    const page = Math.max(1, Number(opts?.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(opts?.limit ?? 30) || 30));
    const qRaw = (opts?.q ?? '').trim().toLowerCase();
    const hasFilter = !!qRaw;

    const transfers = await this.transferRepo.find({
      where: { location: 'BOSTS' as any },
      relations: [
        'items',
        'items.itemBatch',
        'items.itemBatch.itemVariant',
        'items.itemBatch.itemVariant.thickness',
        'items.itemBatch.itemVariant.thickness.item',
        'items.sqmPieces',
      ],
      order: { id: 'DESC' },
    });

    const lines: any[] = [];

    for (const t of transfers) {
      for (const ti of t.items || []) {
        const variant = ti.itemBatch?.itemVariant;
        const thickness = variant?.thickness;
        const item = thickness?.item;

        const lineSqm = num(ti.sqm); // original sqm moved to BOSTS on this line
        const pieces = ti.sqmPieces || [];

        const allocatedSqm = pieces.reduce(
          (sum, p) => sum + num(p.sqmTotal),
          0,
        );
        const soldSqm = pieces.reduce(
          (sum, p) => sum + num(p.sqmSold),
          0,
        );
        const trashFromPiecesSqm = pieces.reduce(
          (sum, p) => sum + num(p.sqmTrash),
          0,
        );
        const remainingPiecesSqm = pieces.reduce(
          (sum, p) => sum + num(p.sqmRemaining),
          0,
        );

        const trashUnallocatedSqm = num((ti as any).sqmTrashUnallocated);

        // Sqm that is converted to sqm on this line but NOT yet split into pieces and not trashed
        const unallocatedSqm = lineSqm - allocatedSqm - trashUnallocatedSqm;

        // Total trash on this line (pieces + unallocated)
        const totalTrashSqm = trashFromPiecesSqm + trashUnallocatedSqm;

        // Sqm that is still available in the system (not sold, not trashed),
        // either as "big lump" (unallocated) or as remaining pieces.
        const availableSqm = unallocatedSqm + remainingPiecesSqm;

        lines.push({
          transferItemId: ti.id,
          transferId: t.id,
          transferNumber: t.transferNumber,
          date: t.date,
          location: t.location,

          itemVariantId: variant?.id ?? null,
          itemName: item?.itemName ?? '',
          itemType: item?.type ?? '',
          thickness: thickness?.thickness ?? null,
          origin: variant?.origin ?? '',

          lineSqm,
          allocatedSqm,
          soldSqm,
          trashFromPiecesSqm,
          trashUnallocatedSqm,
          totalTrashSqm,
          remainingPiecesSqm,
          unallocatedSqm,
          availableSqm,
        });
      }
    }

    // Apply search filter (same logic as frontend was doing)
    const filteredLines = hasFilter
      ? lines.filter((row) => {
          const label =
            (row.thickness != null ? `${row.thickness}ملم ` : '') +
            (row.itemName || '');
          const haystack = [
            label,
            row.origin,
            row.itemType,
            row.transferNumber,
            row.thickness != null ? String(row.thickness) : '',
          ]
            .join(' ')
            .toLowerCase();

          return haystack.includes(qRaw);
        })
      : lines;

    // Group by item (thickness + name), ignoring origin & type
    const map = new Map<string, any>();

    for (const row of filteredLines) {
      // Normalize thickness so "2" and "2.0" are one group
      const thicknessKey =
        row.thickness != null && row.thickness !== ''
          ? String(num(row.thickness))
          : '';
      const nameKey = (row.itemName || '').trim();

      const key = `${thicknessKey}|${nameKey}`;

      let group = map.get(key);
      if (!group) {
        group = {
          key,
          thickness: row.thickness,
          itemName: row.itemName,
          lines: [] as any[],
          totalLineSqm: 0,
          totalAllocatedSqm: 0,
          totalTrashSqm: 0,
          totalAvailableSqm: 0,
          totalSoldSqm: 0,
        };
        map.set(key, group);
      }

      group.lines.push(row);
      group.totalLineSqm += num(row.lineSqm);
      group.totalAllocatedSqm += num(row.allocatedSqm);
      group.totalTrashSqm += num(row.totalTrashSqm);
      group.totalAvailableSqm += num(row.availableSqm);
      group.totalSoldSqm += num(row.soldSqm);
    }

    const allGroups = Array.from(map.values());
    const totalGroups = allGroups.length;

    const start = (page - 1) * limit;
    const end = start + limit;
    const pagedGroups =
      start >= 0 && start < totalGroups ? allGroups.slice(start, end) : [];
    const hasMore = end < totalGroups;

    return {
      page,
      limit,
      totalGroups,
      hasMore,
      data: pagedGroups,
    };
  }

  /**
   * Load header info + existing SqmPieces for one BOSTS transfer line.
   * Used by the "Edit pieces" modal/page.
   */
  async getPiecesForLine(transferItemId: number) {
    const ti = await this.transferItemRepo.findOne({
      where: { id: transferItemId },
      relations: [
        'transfer',
        'itemBatch',
        'itemBatch.itemVariant',
        'itemBatch.itemVariant.thickness',
        'itemBatch.itemVariant.thickness.item',
        'sqmPieces',
      ],
    });

    if (!ti) {
      throw new NotFoundException(`TransferItem #${transferItemId} not found.`);
    }
    if (!ti.transfer || ti.transfer.location !== 'BOSTS') {
      throw new BadRequestException(
        `Sqm pieces can only be defined for BOSTS transfer lines.`,
      );
    }

    const variant = ti.itemBatch?.itemVariant;
    const thickness = variant?.thickness;
    const item = thickness?.item;

    const lineSqm = num(ti.sqm);
    const pieces = ti.sqmPieces || [];

    const allocatedSqm = pieces.reduce(
      (sum, p) => sum + num(p.sqmTotal),
      0,
    );
    const soldSqm = pieces.reduce(
      (sum, p) => sum + num(p.sqmSold),
      0,
    );
    const trashFromPiecesSqm = pieces.reduce(
      (sum, p) => sum + num(p.sqmTrash),
      0,
    );
    const remainingPiecesSqm = pieces.reduce(
      (sum, p) => sum + num(p.sqmRemaining),
      0,
    );

    const trashUnallocatedSqm = num((ti as any).sqmTrashUnallocated);
    const unallocatedSqm = lineSqm - allocatedSqm - trashUnallocatedSqm;
    const availableSqm = remainingPiecesSqm + unallocatedSqm;
    const totalTrashSqm = trashFromPiecesSqm + trashUnallocatedSqm;

    return {
      header: {
        transferItemId: ti.id,
        transferId: ti.transfer.id,
        transferNumber: ti.transfer.transferNumber,
        date: ti.transfer.date,
        itemName: item?.itemName ?? '',
        itemType: item?.type ?? '',
        thickness: thickness?.thickness ?? null,
        origin: variant?.origin ?? '',

        // sqm summary for this line
        totalSqm: lineSqm,
        allocatedSqm,
        soldSqm,
        trashFromPiecesSqm,
        trashUnallocatedSqm,
        totalTrashSqm,
        remainingPiecesSqm,
        unallocatedSqm,
        availableSqm,
      },
      pieces: pieces.map((p) => ({
        id: p.id,
        length: Number(p.length),
        width: Number(p.width),
        piecesCount: p.piecesCount,
        sqmTotal: Number(p.sqmTotal),
        sqmSold: Number(p.sqmSold),
        sqmTrash: Number(p.sqmTrash),
        sqmRemaining: Number(p.sqmRemaining),
        isActive: p.isActive,
      })),
    };
  }

  /**
   * Overwrite the piece allocation for one BOSTS transfer line.
   *
   * body.pieces is expected to be:
   * {
   *   pieces: [
   *     { length: number, width: number, count: number },
   *     ...
   *   ]
   * }
   */
  async savePiecesForLine(
    transferItemId: number,
    body: { pieces?: { length: number; width: number; count: number }[] },
  ) {
    const piecesInput = body?.pieces ?? [];

    return this.sqmPieceRepo.manager.transaction(async (manager) => {
      const ti = await manager.getRepository(TransferItem).findOne({
        where: { id: transferItemId },
        relations: [
          'transfer',
          'itemBatch',
          'itemBatch.itemVariant',
          'itemBatch.itemVariant.thickness',
          'itemBatch.itemVariant.thickness.item',
        ],
      });

      if (!ti) {
        throw new NotFoundException(
          `TransferItem #${transferItemId} not found.`,
        );
      }
      if (!ti.transfer || ti.transfer.location !== 'BOSTS') {
        throw new BadRequestException(
          `Sqm pieces can only be defined for BOSTS transfer lines.`,
        );
      }

      const fromBatch = ti.itemBatch;
      if (!fromBatch || !fromBatch.itemVariant) {
        throw new BadRequestException(
          'TransferItem has no source batch / variant.',
        );
      }

      const fromVariant = fromBatch.itemVariant;
      const parentItem = fromVariant.thickness.item;

      const totalSqmLine = num(ti.sqm);
      const alreadyTrashUnallocated = num((ti as any).sqmTrashUnallocated);

      // Load existing pieces — separate committed (sold or trashed) from clean
      const existingPieces = await manager.getRepository(SqmPiece).find({
        where: { transferItemId },
      });

      const committedPieces = existingPieces.filter(
        (p) => num(p.sqmSold) > 0 || num(p.sqmTrash) > 0,
      );
      const committedKeys = new Set(
        committedPieces.map((p) => `${num(p.length)}|${num(p.width)}`),
      );

      // Delete only clean pieces (no sales, no trash)
      const cleanIds = existingPieces
        .filter((p) => num(p.sqmSold) === 0 && num(p.sqmTrash) === 0)
        .map((p) => p.id);
      if (cleanIds.length) {
        await manager.getRepository(SqmPiece).delete(cleanIds);
      }

      // Split user input: dimensions matching a committed piece are updates,
      // everything else is a genuinely new piece group.
      type CommittedUpdate = {
        piece: SqmPiece;
        newCount: number;
        sqmPerPiece: number;
      };
      const committedUpdates = new Map<string, CommittedUpdate>();
      const newPiecesInput: typeof piecesInput = [];

      for (const row of piecesInput) {
        const key = `${num(row.length)}|${num(row.width)}`;
        if (committedKeys.has(key)) {
          const piece = committedPieces.find(
            (p) => `${num(p.length)}|${num(p.width)}` === key,
          );
          if (piece) {
            const L = num(row.length);
            const W = num(row.width);
            committedUpdates.set(key, {
              piece,
              newCount: Math.max(0, Math.floor(num(row.count))),
              sqmPerPiece: (L * W) / 10000,
            });
          }
        } else {
          newPiecesInput.push(row);
        }
      }

      // Validate committed updates: new count must not go below already-consumed sqm
      let updatedCommittedSqm = 0;
      for (const { piece, newCount, sqmPerPiece } of committedUpdates.values()) {
        const newSqmTotal = newCount * sqmPerPiece;
        const consumed = num(piece.sqmSold) + num(piece.sqmTrash);
        if (newSqmTotal + 0.0001 < consumed) {
          throw new BadRequestException(
            `Cannot set count ${newCount} for piece ${num(piece.length)}x${num(piece.width)}: already consumed ${consumed.toFixed(4)} sqm.`,
          );
        }
        updatedCommittedSqm += newSqmTotal;
      }

      // Committed pieces the user didn't include keep their existing sqmTotal
      const unchangedCommittedSqm = committedPieces
        .filter((p) => !committedUpdates.has(`${num(p.length)}|${num(p.width)}`))
        .reduce((sum, p) => sum + num(p.sqmTotal), 0);

      // Validate total sqm: all committed + new pieces + unallocated trash <= line sqm
      let sumPiecesSqm = 0;
      for (const row of newPiecesInput) {
        const L = num(row.length);
        const W = num(row.width);
        const count = Math.max(0, Math.floor(num(row.count)));
        sumPiecesSqm += count * ((L * W) / 10000);
      }

      const totalAllocatedSqm = updatedCommittedSqm + unchangedCommittedSqm + sumPiecesSqm;
      if (totalAllocatedSqm + alreadyTrashUnallocated - totalSqmLine > 0.0001) {
        throw new BadRequestException(
          `Allocated sqm (${totalAllocatedSqm.toFixed(4)}) + trashed unallocated (${alreadyTrashUnallocated.toFixed(4)}) exceeds line sqm (${totalSqmLine.toFixed(4)}).`,
        );
      }

      // 2) resolve sqm thickness and variant (same as BOSTS logic)
      const sqmThickness = await manager
        .getRepository(Thickness)
        .createQueryBuilder('th')
        .innerJoin(
          'th.item',
          'it',
          'it.itemName = :name AND it.type = :type',
          {
            name: parentItem.itemName,
            type: 'sqm',
          },
        )
        .where('th.thickness = :thick', {
          thick: fromVariant.thickness.thickness,
        })
        .getOne();

      if (!sqmThickness) {
        throw new NotFoundException(
          `No "sqm" thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
        );
      }

      const sqmVariants = await manager.getRepository(ItemVariant).find({
        where: {
          thickness: { id: sqmThickness.id } as any,
        },
      });

      if (!sqmVariants.length) {
        throw new NotFoundException(
          `No sqm variant for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}`,
        );
      }

      const sqmVariant =
        sqmVariants.find(
          (v: any) =>
            v.realDescriptionId !== null && v.realDescriptionId !== undefined,
        ) || sqmVariants[0];

      // 3) find or create the sqm batch (same condition + dateReceived)
      let sqmBatch = await manager.getRepository(ItemBatch).findOne({
        where: {
          itemVariant: { id: sqmVariant.id } as any,
          condition: fromBatch.condition,
          dateReceived: fromBatch.dateReceived,
        },
      });

      if (!sqmBatch) {
        sqmBatch = manager.getRepository(ItemBatch).create({
          itemVariant: sqmVariant,
          condition: fromBatch.condition,
          dateReceived: fromBatch.dateReceived,
        });
        await manager.getRepository(ItemBatch).save(sqmBatch);
      }

      // 4a) apply committed piece updates (user re-added or increased count for sold dimension)
      for (const { piece, newCount, sqmPerPiece } of committedUpdates.values()) {
        const newSqmTotal = newCount * sqmPerPiece;
        const consumed = num(piece.sqmSold) + num(piece.sqmTrash);
        piece.piecesCount = newCount;
        piece.sqmTotal = newSqmTotal;
        piece.sqmRemaining = Math.max(0, newSqmTotal - consumed);
        await manager.getRepository(SqmPiece).save(piece);
      }

      // 4b) insert genuinely new pieces (clean pieces already deleted above)
      const toInsert: SqmPiece[] = [];

      for (const row of newPiecesInput) {
        const L = num(row.length);
        const W = num(row.width);
        let count = Math.max(0, Math.floor(num(row.count)));
        if (!L || !W || !count) continue;

        const sqmPerPiece = (L * W) / 10000;
        const sqmTotal = count * sqmPerPiece;

        const piece = manager.getRepository(SqmPiece).create({
          transferItemId,
          sqmVariantId: sqmVariant.id,
          sqmBatchId: sqmBatch.id,
          length: L,
          width: W,
          piecesCount: count,
          sqmTotal,
          sqmSold: 0,
          sqmRemaining: sqmTotal,
          isActive: true,
        });

        toInsert.push(piece);
      }

      if (toInsert.length) {
        await manager.getRepository(SqmPiece).save(toInsert);
      }

      return this.getPiecesForLine(transferItemId);
    });
  }

  /**
   * Summary grouped by sqmVariantId.
   * Each row = one sqm variant and totals of pieces.
   * Also includes, for each contributing transfer line, the *source* ItemVariant
   * (the box/sheet that was converted to sqm).
   */
  async summaryBySqmVariant() {
    const pieces = await this.sqmPieceRepo.find({
      relations: [
        'sqmVariant',
        'sqmVariant.thickness',
        'sqmVariant.thickness.item',
        'transferItem',
        'transferItem.transfer',
        'transferItem.itemBatch',
        'transferItem.itemBatch.itemVariant',
        'transferItem.itemBatch.itemVariant.thickness',
        'transferItem.itemBatch.itemVariant.thickness.item',
      ],
    });

    const map = new Map<number, any>();

    for (const p of pieces) {
      const key = p.sqmVariantId;
      const sqmVariant = p.sqmVariant;
      const sqmItem = sqmVariant.thickness.item;

      if (!map.has(key)) {
        map.set(key, {
          sqmVariantId: key,
          itemName: sqmItem.itemName,
          thickness: sqmVariant.thickness.thickness,
          origin: sqmVariant.origin,
          totalSqmPieces: 0,
          totalSqmRemaining: 0,
          transfers: new Map<number, any>(),
        });
      }

      const entry = map.get(key);
      entry.totalSqmPieces += num(p.sqmTotal);
      entry.totalSqmRemaining += num(p.sqmRemaining);

      const ti = p.transferItem;
      const tr = ti.transfer;

      const fromVariant = ti.itemBatch?.itemVariant;
      const fromThickness = fromVariant?.thickness;
      const fromItem = fromThickness?.item;

      if (!entry.transfers.has(ti.id)) {
        entry.transfers.set(ti.id, {
          transferItemId: ti.id,
          transferId: tr?.id ?? null,
          transferNumber: tr?.transferNumber ?? '',
          date: tr?.date ?? null,

          // how much was moved to sqm on this BOSTS line
          lineSqm: num(ti.sqm),
          quantity: num(ti.quantity), // boxes or sheets
          allocatedSqm: 0,
          piecesGroupsCount: 0,

          // >>> SOURCE ITEM VARIANT <<<
          sourceItemVariantId: fromVariant?.id ?? null,
          sourceItemName: fromItem?.itemName ?? '',
          sourceItemType: fromItem?.type ?? '', // 'box' | 'sheet' | ...
          sourceThickness: fromThickness?.thickness ?? null,
          sourceOrigin: fromVariant?.origin ?? '',
          sourceLength: fromVariant ? Number(fromVariant.length) : null,
          sourceWidth: fromVariant ? Number(fromVariant.width) : null,
          sourceSheetsPerBox: fromVariant?.sheetsPerBox ?? null,
        });
      }

      const trEntry = entry.transfers.get(ti.id);
      trEntry.allocatedSqm += num(p.sqmTotal);
      trEntry.piecesGroupsCount += 1;
    }

    // Flatten maps and compute remainingUnallocated
    return [...map.values()].map((v) => ({
      ...v,
      transfers: [...v.transfers.values()].map((t) => ({
        ...t,
        remainingUnallocated: num(t.lineSqm) - num(t.allocatedSqm),
      })),
    }));
  }

  /**
   * Detailed breakdown for a single sqmVariant (used by expanding rows).
   */
  async summaryForOneVariant(sqmVariantId: number) {
    const pieces = await this.sqmPieceRepo.find({
      where: { sqmVariantId },
      relations: [
        'sqmVariant',
        'sqmVariant.thickness',
        'sqmVariant.thickness.item',
        'transferItem',
        'transferItem.transfer',
      ],
    });

    if (!pieces.length) {
      throw new NotFoundException('No pieces for this sqm variant.');
    }

    const variant = pieces[0].sqmVariant;
    const item = variant.thickness.item;

    const map = new Map<number, any>();

    for (const p of pieces) {
      const ti = p.transferItem;
      const tr = ti.transfer;

      if (!map.has(ti.id)) {
        map.set(ti.id, {
          transferItemId: ti.id,
          transferId: tr.id,
          transferNumber: tr.transferNumber,
          date: tr.date,
          lineSqm: Number(ti.sqm),
          allocatedSqm: 0,
          remainingUnallocated: 0,
          piecesGroupsCount: 0,
        });
      }

      const e = map.get(ti.id);

      e.allocatedSqm += Number(p.sqmTotal);
      e.piecesGroupsCount += 1;
      e.remainingUnallocated = e.lineSqm - e.allocatedSqm;
    }

    return {
      sqmVariantId,
      itemName: item.itemName,
      thickness: variant.thickness.thickness,
      origin: variant.origin,
      transfers: [...map.values()],
    };
  }

  /**
   * Trash (discard) some sqm from a single piece group.
   * This will:
   *  - increase sqmTrash
   *  - decrease sqmRemaining
   *  - create an InventoryTransaction "SqmTrash"
   *  - update sqm batch + variant OFR totals
   */
  async trashFromPiece(
    pieceId: number,
    body: { sqmToTrash: number; date?: string | Date },
  ) {
    const sqmToTrash = num(body?.sqmToTrash);
    if (sqmToTrash <= 0) {
      throw new BadRequestException('sqmToTrash must be > 0.');
    }

    // If date given → use it; else now
    const txDate =
      body?.date instanceof Date
        ? body.date
        : body?.date
        ? new Date(body.date)
        : new Date();

    return this.sqmPieceRepo.manager.transaction(async (manager) => {
      const piece = await manager.getRepository(SqmPiece).findOne({
        where: { id: pieceId },
        relations: ['sqmVariant', 'sqmBatch'],
      });

      if (!piece) {
        throw new NotFoundException(`SqmPiece #${pieceId} not found.`);
      }

      const remaining = num(piece.sqmRemaining);
      if (sqmToTrash - remaining > 0.0001) {
        throw new BadRequestException(
          `Cannot trash ${sqmToTrash.toFixed(
            4,
          )} sqm because only ${remaining.toFixed(4)} sqm remains in this piece group.`,
        );
      }

      const variant = piece.sqmVariant;
      const batch = piece.sqmBatch;

      if (!variant || !batch) {
        throw new BadRequestException(
          'SqmPiece is missing sqmVariant or sqmBatch relations.',
        );
      }
      
const costs = {
  ofr: num(variant.averageCost),
  vm: num(variant.averageCostVM),
};

      // 1) Create InventoryTransaction for the trash
      const invTx = manager.getRepository(InventoryTransaction).create({
        itemVariantId: piece.sqmVariantId,
        itemBatchId: piece.sqmBatchId,
        transactionType: 'SqmTrash',
        quantity: 0,
        quantityofr: -sqmToTrash,
        sqm: 0,
        sqmofr: -sqmToTrash,
       finalcostofr: costs.ofr,
  finalcost: costs.vm, 
        transferId: null,
        dateForEachInvoice: txDate,
      });
      await manager.getRepository(InventoryTransaction).save(invTx);

      // 2) Update batch
      batch.outOFR = num(batch.outOFR) + sqmToTrash;
      batch.balanceOFR =
        num(batch.startOFR) + num(batch.inOFR) - num(batch.outOFR);
      await manager.getRepository(ItemBatch).save(batch);

      // 3) Update variant
      variant.totalOutOFR = num(variant.totalOutOFR) + sqmToTrash;
      variant.totalBalanceOFR =
        num(variant.totalStartOFR) +
        num(variant.totalInOFR) -
        num(variant.totalOutOFR);
      await manager.getRepository(ItemVariant).save(variant);

      // 4) Update piece
      piece.sqmTrash = num(piece.sqmTrash) + sqmToTrash;
      piece.sqmRemaining = remaining - sqmToTrash;
      await manager.getRepository(SqmPiece).save(piece);

      return piece;
    });
  }

  /**
   * Restore sqm from trash back to "remaining" for a single piece group.
   * This will:
   *  - decrease sqmTrash
   *  - increase sqmRemaining
   *  - create an InventoryTransaction "SqmTrashRestore"
   *  - reverse the OFR totals on batch + variant
   */
  async restoreFromPiece(
    pieceId: number,
    body: { sqmToRestore: number; date?: string | Date },
  ) {
    const sqmToRestore = num(body?.sqmToRestore);
    if (sqmToRestore <= 0) {
      throw new BadRequestException('sqmToRestore must be > 0.');
    }

    // Use passed date or "now"
    const txDate =
      body?.date instanceof Date
        ? body.date
        : body?.date
        ? new Date(body.date)
        : new Date();

    return this.sqmPieceRepo.manager.transaction(async (manager) => {
      const piece = await manager.getRepository(SqmPiece).findOne({
        where: { id: pieceId },
        relations: ['sqmVariant', 'sqmBatch'],
      });

      if (!piece) {
        throw new NotFoundException(`SqmPiece #${pieceId} not found.`);
      }

      const trashed = num(piece.sqmTrash);
      if (trashed <= 0) {
        throw new BadRequestException('No trashed sqm to restore in this piece group.');
      }
      if (sqmToRestore - trashed > 0.0001) {
        throw new BadRequestException(
          `Cannot restore ${sqmToRestore.toFixed(
            4,
          )} sqm because only ${trashed.toFixed(4)} sqm is trashed in this piece group.`,
        );
      }

      const variant = piece.sqmVariant;
      const batch = piece.sqmBatch;

      if (!variant || !batch) {
        throw new BadRequestException(
          'SqmPiece is missing sqmVariant or sqmBatch relations.',
        );
      }

      const costs = {
  ofr: num(variant.averageCost),
  vm: num(variant.averageCostVM),
};

      // 1) InventoryTransaction for restore
      const invTx = manager.getRepository(InventoryTransaction).create({
        itemVariantId: piece.sqmVariantId,
        itemBatchId: piece.sqmBatchId,
        transactionType: 'SqmTrashRestore', // 👈 choose any code you like
        quantity: 0,
        quantityofr: sqmToRestore, // positive (add back)
        sqm: 0,
        sqmofr: sqmToRestore,
       finalcostofr: costs.ofr, 
  finalcost: costs.vm, 
        transferId: null,
        dateForEachInvoice: txDate,
      });
      await manager.getRepository(InventoryTransaction).save(invTx);

      // 2) Reverse batch outOFR
      batch.outOFR = num(batch.outOFR) - sqmToRestore;
      batch.balanceOFR =
        num(batch.startOFR) + num(batch.inOFR) - num(batch.outOFR);
      await manager.getRepository(ItemBatch).save(batch);

      // 3) Reverse variant totals
      variant.totalOutOFR = num(variant.totalOutOFR) - sqmToRestore;
      variant.totalBalanceOFR =
        num(variant.totalStartOFR) +
        num(variant.totalInOFR) -
        num(variant.totalOutOFR);
      await manager.getRepository(ItemVariant).save(variant);

      // 4) Update piece itself
      piece.sqmTrash = trashed - sqmToRestore;
      piece.sqmRemaining = num(piece.sqmRemaining) + sqmToRestore;

      // if we restored some, piece is clearly active again
      piece.isActive = true;

      return manager.getRepository(SqmPiece).save(piece);
    });
  }

  /**
   * Trash some of the "unallocated" sqm on a BOSTS line.
   *
   * - Works only on BOSTS transfer lines.
   * - "Unallocated" = line.sqm - sum(all SqmPiece.sqmTotal)  (for this line)
   * - Creates:
   *    • InventoryTransaction "SqmTrash"
   *    • A special SqmPiece row with sqmTotal = sqmTrash, sqmRemaining = 0, sqmTrash = sqmTrash
   *      (length/width = 0, piecesCount = 0)
   * So the leftover (not represented in any dimensioned piece) is tracked as trash.
   */
  async trashRemainingForLine(
    transferItemId: number,
    body: { sqmToTrash: number; date?: string | Date },
  ) {
    const sqmToTrash = num(body?.sqmToTrash);
    if (sqmToTrash <= 0) {
      throw new BadRequestException('sqmToTrash must be > 0.');
    }

    const txDate =
      body?.date instanceof Date
        ? body.date
        : body?.date
        ? new Date(body.date)
        : new Date();

    return this.sqmPieceRepo.manager.transaction(async (manager) => {
      const ti = await manager.getRepository(TransferItem).findOne({
        where: { id: transferItemId },
        relations: [
          'transfer',
          'itemBatch',
          'itemBatch.itemVariant',
          'itemBatch.itemVariant.thickness',
          'itemBatch.itemVariant.thickness.item',
          'sqmPieces',
        ],
      });

      if (!ti) {
        throw new NotFoundException(
          `TransferItem #${transferItemId} not found.`,
        );
      }
      if (!ti.transfer || ti.transfer.location !== 'BOSTS') {
        throw new BadRequestException(
          'Can only trash remaining sqm for BOSTS lines.',
        );
      }

      const fromBatch = ti.itemBatch;
      const fromVariant = fromBatch?.itemVariant;
      const parentItem = fromVariant?.thickness?.item;

      if (!fromBatch || !fromVariant || !parentItem) {
        throw new BadRequestException(
          'TransferItem has no valid source batch / variant / item.',
        );
      }

      const totalSqmLine = num(ti.sqm);
      const existingPieces = ti.sqmPieces || [];

      const allocatedSqm = existingPieces.reduce(
        (sum, p) => sum + num(p.sqmTotal),
        0,
      );

      const remainingUnallocated = totalSqmLine - allocatedSqm;

      if (sqmToTrash - remainingUnallocated > 0.0001) {
        throw new BadRequestException(
          `Cannot trash ${sqmToTrash.toFixed(
            4,
          )} sqm because only ${remainingUnallocated.toFixed(
            4,
          )} sqm are unallocated on this line.`,
        );
      }

      // ----- Resolve sqm thickness + variant (same as in savePiecesForLine) -----
      const sqmThickness = await manager
        .getRepository(Thickness)
        .createQueryBuilder('th')
        .innerJoin(
          'th.item',
          'it',
          'it.itemName = :name AND it.type = :type',
          {
            name: parentItem.itemName,
            type: 'sqm',
          },
        )
        .where('th.thickness = :thick', {
          thick: fromVariant.thickness.thickness,
        })
        .getOne();

      if (!sqmThickness) {
        throw new NotFoundException(
          `No "sqm" thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
        );
      }

      const sqmVariants = await manager.getRepository(ItemVariant).find({
        where: {
          thickness: { id: sqmThickness.id } as any,
        },
      });

      if (!sqmVariants.length) {
        throw new NotFoundException(
          `No sqm variant for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}`,
        );
      }

      const sqmVariant =
        sqmVariants.find(
          (v: any) =>
            v.realDescriptionId !== null && v.realDescriptionId !== undefined,
        ) || sqmVariants[0];

      // ----- Find/Create sqm batch (same condition + dateReceived) -----
      let sqmBatch = await manager.getRepository(ItemBatch).findOne({
        where: {
          itemVariant: { id: sqmVariant.id } as any,
          condition: fromBatch.condition,
          dateReceived: fromBatch.dateReceived,
        },
      });

      if (!sqmBatch) {
        sqmBatch = manager.getRepository(ItemBatch).create({
          itemVariant: sqmVariant,
          condition: fromBatch.condition,
          dateReceived: fromBatch.dateReceived,
        });
        await manager.getRepository(ItemBatch).save(sqmBatch);
      }

      const costs = {
        ofr: num((sqmVariant as any).averageCost),
        vm: num((sqmVariant as any).averageCostVM),
      };
      // ----- 1) InventoryTransaction "SqmTrash" -----
      const invTx = manager.getRepository(InventoryTransaction).create({
        itemVariantId: sqmVariant.id,
        itemBatchId: sqmBatch.id,
        transactionType: 'SqmTrash',
        quantity: 0,
        quantityofr: -sqmToTrash,
        sqm: 0,
        sqmofr: -sqmToTrash,
     finalcost: costs.vm,      
        finalcostofr: costs.ofr,
        transferId: null, // or ti.transferId if you have that column
        dateForEachInvoice: txDate,
      });
      await manager.getRepository(InventoryTransaction).save(invTx);

      // ----- 2) Update batch OFR -----
      sqmBatch.outOFR = num(sqmBatch.outOFR) + sqmToTrash;
      sqmBatch.balanceOFR =
        num(sqmBatch.startOFR) + num(sqmBatch.inOFR) - num(sqmBatch.outOFR);
      await manager.getRepository(ItemBatch).save(sqmBatch);

      // ----- 3) Update variant OFR -----
      sqmVariant.totalOutOFR = num(sqmVariant.totalOutOFR) + sqmToTrash;
      sqmVariant.totalBalanceOFR =
        num(sqmVariant.totalStartOFR) +
        num(sqmVariant.totalInOFR) -
        num(sqmVariant.totalOutOFR);
      await manager.getRepository(ItemVariant).save(sqmVariant);

      // ----- 4) Create a "trash-only" SqmPiece row -----
      const trashPiece = manager.getRepository(SqmPiece).create({
        transferItemId,
        sqmVariantId: sqmVariant.id,
        sqmBatchId: sqmBatch.id,
        length: 0,
        width: 0,
        piecesCount: 0,
        sqmTotal: sqmToTrash,
        sqmSold: 0,
        sqmTrash: sqmToTrash,
        sqmRemaining: 0,
        isActive: true,
      });
      await manager.getRepository(SqmPiece).save(trashPiece);

      // Return standard header + pieces for this line
      return this.getPiecesForLine(transferItemId);
    });
  }

  /**
   * Trash some sqm that is still UNALLOCATED on this BOSTS line.
   *
   * This will:
   *  - create InventoryTransaction "SqmTrashUnallocated"
   *  - update sqm batch + variant OFR totals
   *  - increment transferItem.sqmTrashUnallocated
   *  - (pieces remain unchanged)
   */
async trashUnallocatedForLine(
  transferItemId: number,
  body: { sqmToTrash: number; date?: string | Date },
) {
  const sqmToTrash = num(body?.sqmToTrash);
  if (sqmToTrash <= 0) {
    throw new BadRequestException('sqmToTrash must be > 0.');
  }

  const txDate =
    body?.date instanceof Date
      ? body.date
      : body?.date
      ? new Date(body.date)
      : new Date();

  return this.sqmPieceRepo.manager.transaction(async (manager) => {
    const ti = await manager.getRepository(TransferItem).findOne({
      where: { id: transferItemId },
      relations: [
        'transfer',
        'itemBatch',
        'itemBatch.itemVariant',
        'itemBatch.itemVariant.thickness',
        'itemBatch.itemVariant.thickness.item',
        'sqmPieces',
      ],
    });

    if (!ti) {
      throw new NotFoundException(
        `TransferItem #${transferItemId} not found.`,
      );
    }
    if (!ti.transfer || ti.transfer.location !== 'BOSTS') {
      throw new BadRequestException(
        'Can only trash unallocated sqm for BOSTS lines.',
      );
    }

    const fromBatch = ti.itemBatch;
    const fromVariant = fromBatch?.itemVariant;
    const parentItem = fromVariant?.thickness?.item;

    if (!fromBatch || !fromVariant || !parentItem) {
      throw new BadRequestException(
        'TransferItem has no valid source batch / variant / item.',
      );
    }

    const totalSqmLine = num(ti.sqm);
    const existingPieces = ti.sqmPieces || [];

    const allocatedSqm = existingPieces.reduce(
      (sum, p) => sum + num(p.sqmTotal),
      0,
    );

    const trashUnallocatedSqmSaved = num((ti as any).sqmTrashUnallocated ?? 0);
    let unallocatedSqm = totalSqmLine - allocatedSqm - trashUnallocatedSqmSaved;
    if (!Number.isFinite(unallocatedSqm)) unallocatedSqm = 0;
    if (unallocatedSqm < 0) unallocatedSqm = 0;

    if (sqmToTrash - unallocatedSqm > 0.0001) {
      throw new BadRequestException(
        `Cannot trash ${sqmToTrash.toFixed(
          4,
        )} sqm because only ${unallocatedSqm.toFixed(
          4,
        )} sqm are unallocated on this line.`,
      );
    }

    // ----- Resolve sqm thickness + variant -----
    const sqmThickness = await manager
      .getRepository(Thickness)
      .createQueryBuilder('th')
      .innerJoin(
        'th.item',
        'it',
        'it.itemName = :name AND it.type = :type',
        {
          name: parentItem.itemName,
          type: 'sqm',
        },
      )
      .where('th.thickness = :thick', {
        thick: fromVariant.thickness.thickness,
      })
      .getOne();

    if (!sqmThickness) {
      throw new NotFoundException(
        `No "sqm" thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
      );
    }

    const sqmVariants = await manager.getRepository(ItemVariant).find({
      where: {
        thickness: { id: sqmThickness.id } as any,
      },
    });

    if (!sqmVariants.length) {
      throw new NotFoundException(
        `No sqm variant for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}`,
      );
    }

    const sqmVariant =
      sqmVariants.find(
        (v: any) =>
          v.realDescriptionId !== null && v.realDescriptionId !== undefined,
      ) || sqmVariants[0];

    // ----- Find/Create sqm batch -----
    let sqmBatch = await manager.getRepository(ItemBatch).findOne({
      where: {
        itemVariant: { id: sqmVariant.id } as any,
        condition: fromBatch.condition,
        dateReceived: fromBatch.dateReceived,
      },
    });

    if (!sqmBatch) {
      sqmBatch = manager.getRepository(ItemBatch).create({
        itemVariant: sqmVariant,
        condition: fromBatch.condition,
        dateReceived: fromBatch.dateReceived,
      });
      await manager.getRepository(ItemBatch).save(sqmBatch);
    }
          const costs = {
        ofr: num((sqmVariant as any).averageCost),
        vm: num((sqmVariant as any).averageCostVM),
      };

    // ✅ 1) Create InventoryTransaction with SqmTrash type
    const invTx = manager.getRepository(InventoryTransaction).create({
      itemVariantId: sqmVariant.id,
      itemBatchId: sqmBatch.id,
      transactionType: 'SqmTrash',
      quantity: 0,           // ✅ Zero for regular quantity
      quantityofr: -sqmToTrash, // ✅ Negative for OFR quantity
      sqm: 0,                // ✅ Zero for regular sqm
      sqmofr: -sqmToTrash,   // ✅ Negative for OFR sqm
       finalcost: costs.vm,        // ✅ Add actual VM cost
        finalcostofr: costs.ofr,        // ✅ Add actual OFR cost
      transferId: ti.transfer?.id || null,
      dateForEachInvoice: txDate,
    });
    await manager.getRepository(InventoryTransaction).save(invTx);

    // ✅ 2) Update batch OFR
    sqmBatch.outOFR = num(sqmBatch.outOFR) + sqmToTrash;
    sqmBatch.balanceOFR =
      num(sqmBatch.startOFR) + num(sqmBatch.inOFR) - num(sqmBatch.outOFR);
    await manager.getRepository(ItemBatch).save(sqmBatch);

    // ✅ 3) Update variant OFR
    sqmVariant.totalOutOFR = num(sqmVariant.totalOutOFR) + sqmToTrash;
    sqmVariant.totalBalanceOFR =
      num(sqmVariant.totalStartOFR) +
      num(sqmVariant.totalInOFR) -
      num(sqmVariant.totalOutOFR);
    await manager.getRepository(ItemVariant).save(sqmVariant);

    // ✅ 4) Update TransferItem to track trashed unallocated sqm
    (ti as any).sqmTrashUnallocated =
      trashUnallocatedSqmSaved + sqmToTrash;
    await manager.getRepository(TransferItem).save(ti);

    return {
      transferItemId,
      sqmTrashed: sqmToTrash,
      totalSqmTrashUnallocated: (ti as any).sqmTrashUnallocated,
    };
  });
}

  /**
   * Restore previously trashed *unallocated* sqm on a BOSTS transfer line.
   *
   * - Decreases TransferItem.sqmTrashUnallocated
   * - Creates inverse InventoryTransaction (positive sqm)
   * - Decreases batch / variant OUT totals
   */
  async restoreUnallocatedForLine(
    transferItemId: number,
    body: { sqmToRestore: number; date?: string | Date },
  ) {
    const sqmToRestore = num(body?.sqmToRestore);
    if (sqmToRestore <= 0) {
      throw new BadRequestException('sqmToRestore must be > 0.');
    }

    const txDate =
      body?.date instanceof Date
        ? body.date
        : body?.date
        ? new Date(body.date)
        : new Date();

    return this.sqmPieceRepo.manager.transaction(async (manager) => {
      const ti = await manager.getRepository(TransferItem).findOne({
        where: { id: transferItemId },
        relations: [
          'transfer',
          'itemBatch',
          'itemBatch.itemVariant',
          'itemBatch.itemVariant.thickness',
          'itemBatch.itemVariant.thickness.item',
        ],
      });

      if (!ti) {
        throw new NotFoundException(
          `TransferItem #${transferItemId} not found.`,
        );
      }
      if (!ti.transfer || ti.transfer.location !== 'BOSTS') {
        throw new BadRequestException(
          'Unallocated sqm trash/restore is only allowed for BOSTS lines.',
        );
      }

      const fromBatch = ti.itemBatch;
      if (!fromBatch || !fromBatch.itemVariant) {
        throw new BadRequestException(
          'TransferItem has no source batch / variant.',
        );
      }

      const trashedUnalloc = num((ti as any).sqmTrashUnallocated);
      if (sqmToRestore - trashedUnalloc > 0.0001) {
        throw new BadRequestException(
          `Cannot restore ${sqmToRestore.toFixed(
            4,
          )} sqm because only ${trashedUnalloc.toFixed(
            4,
          )} sqm is trashed (unallocated) on this line.`,
        );
      }

      const fromVariant = fromBatch.itemVariant;
      const parentItem = fromVariant.thickness.item;

      // ── 1) Resolve sqm thickness + variant (same as savePiecesForLine) ──
      const sqmThickness = await manager
        .getRepository(Thickness)
        .createQueryBuilder('th')
        .innerJoin(
          'th.item',
          'it',
          'it.itemName = :name AND it.type = :type',
          {
            name: parentItem.itemName,
            type: 'sqm',
          },
        )
        .where('th.thickness = :thick', {
          thick: fromVariant.thickness.thickness,
        })
        .getOne();

      if (!sqmThickness) {
        throw new NotFoundException(
          `No "sqm" thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
        );
      }

      const sqmVariants = await manager.getRepository(ItemVariant).find({
        where: {
          thickness: { id: sqmThickness.id } as any,
        },
      });

      if (!sqmVariants.length) {
        throw new NotFoundException(
          `No sqm variant for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}`,
        );
      }

      const sqmVariant =
        sqmVariants.find(
          (v: any) =>
            v.realDescriptionId !== null && v.realDescriptionId !== undefined,
        ) || sqmVariants[0];

      // ── 2) Find or create sqm batch ──
      let sqmBatch = await manager.getRepository(ItemBatch).findOne({
        where: {
          itemVariant: { id: sqmVariant.id } as any,
          condition: fromBatch.condition,
          dateReceived: fromBatch.dateReceived,
        },
      });

      if (!sqmBatch) {
        sqmBatch = manager.getRepository(ItemBatch).create({
          itemVariant: sqmVariant,
          condition: fromBatch.condition,
          dateReceived: fromBatch.dateReceived,
        });
        await manager.getRepository(ItemBatch).save(sqmBatch);
      }


            const costs = {
        ofr: num((sqmVariant as any).averageCost),
        vm: num((sqmVariant as any).averageCostVM),
      };
      
      // ── 3) Create inverse InventoryTransaction for restore ──
      const invTx = manager.getRepository(InventoryTransaction).create({
        itemVariantId: sqmVariant.id,
        itemBatchId: sqmBatch.id,
        transactionType: 'SqmTrashRestore', // <── new type
        quantity: 0,
        quantityofr: sqmToRestore,
        sqm: 0,
        sqmofr: sqmToRestore,
          finalcost: costs.vm,        // ✅ Add actual VM cost
        finalcostofr: costs.ofr,
        transferId: ti.transferId ?? null,
        dateForEachInvoice: txDate,
      });
      await manager.getRepository(InventoryTransaction).save(invTx);

      // ── 4) Update batch OUT / balance ──
      sqmBatch.outOFR = num(sqmBatch.outOFR) - sqmToRestore;
      sqmBatch.balanceOFR =
        num(sqmBatch.startOFR) + num(sqmBatch.inOFR) - num(sqmBatch.outOFR);
      await manager.getRepository(ItemBatch).save(sqmBatch);

      // ── 5) Update variant total OUT / balance ──
      sqmVariant.totalOutOFR = num(sqmVariant.totalOutOFR) - sqmToRestore;
      sqmVariant.totalBalanceOFR =
        num(sqmVariant.totalStartOFR) +
        num(sqmVariant.totalInOFR) -
        num(sqmVariant.totalOutOFR);
      await manager.getRepository(ItemVariant).save(sqmVariant);

      // ── 6) Decrease unallocated trash on this line ──
      (ti as any).sqmTrashUnallocated = trashedUnalloc - sqmToRestore;
      await manager.getRepository(TransferItem).save(ti);

      // ── 7) Return updated header + pieces for the modal ──
      const result = await this.getPiecesForLine(transferItemId);

      return {
        ...result,
        header: {
          ...result.header,
          trashUnallocatedSqm: (ti as any).sqmTrashUnallocated,
        },
      };
    });
  }



    /**
   * Trash ALL remaining sqm (pieces + unallocated) for a group:
   * - Group is defined by the same key used in listBostsLines:
   *     "<thicknessKey>|<itemNameTrimmed>"
   *   where thicknessKey = String(num(thickness)) or "" if null.
   *
   * For each BOSTS TransferItem in that group:
   *   - Trash all unallocated sqm (via trashUnallocatedForLine)
   *   - Trash all remaining sqm in each SqmPiece (via trashFromPiece)
   */
async trashAllForGroup(body: { groupKey: string; date?: string | Date }) {
  const groupKey = (body?.groupKey ?? '').trim();
  if (!groupKey) {
    throw new BadRequestException('groupKey is required.');
  }

  const [thicknessKeyRaw, ...nameParts] = groupKey.split('|');
  const thicknessKey = (thicknessKeyRaw ?? '').trim();
  const nameKey = nameParts.join('|').trim(); // in case itemName ever contains '|'

  // Load all BOSTS transfers + items + pieces
  const transfers = await this.transferRepo.find({
    where: { location: 'BOSTS' as any },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemBatch.itemVariant',
      'items.itemBatch.itemVariant.thickness',
      'items.itemBatch.itemVariant.thickness.item',
      'items.sqmPieces',
    ],
    order: { id: 'DESC' },
  });

  let matchedLinesCount = 0;
  let trashedUnallocatedSqm = 0;
  let trashedPiecesSqm = 0; // kept for response shape, but we won't touch pieces here

  for (const t of transfers) {
    for (const ti of t.items || []) {
      const variant = ti.itemBatch?.itemVariant;
      const thickness = variant?.thickness;
      const item = thickness?.item;

      // Build row key exactly like grouping
      const rowThickness =
        thickness?.thickness != null ? String(num(thickness.thickness)) : '';
      const rowName = (item?.itemName ?? '').trim();
      const rowKey = `${rowThickness}|${rowName}`;

      if (rowKey !== groupKey) continue;

      matchedLinesCount++;

      const pieces = ti.sqmPieces || [];

      const lineSqm = num(ti.sqm);
      const allocatedSqm = pieces.reduce(
        (sum, p) => sum + num(p.sqmTotal),
        0,
      );
      const trashUnallocatedSqmSaved = num(
        (ti as any).sqmTrashUnallocated ?? 0,
      );

      // Unallocated = what is not in pieces and not already trashed as unallocated
      let unallocatedSqm = lineSqm - allocatedSqm - trashUnallocatedSqmSaved;
      if (!Number.isFinite(unallocatedSqm)) unallocatedSqm = 0;
      if (unallocatedSqm < 0) unallocatedSqm = 0; // clamp tiny negatives

      // If this line has no unallocated sqm left, skip it
      if (unallocatedSqm <= 0.0001) continue;

      // Trash ALL unallocated sqm on this line
      await this.trashUnallocatedForLine(ti.id, {
        sqmToTrash: unallocatedSqm,
        date: body?.date,
      });
      trashedUnallocatedSqm += unallocatedSqm;
    }
  }

  if (!matchedLinesCount) {
    throw new NotFoundException(
      `No BOSTS lines found for groupKey="${groupKey}".`,
    );
  }

  if (trashedUnallocatedSqm <= 0.0001) {
    // Group exists, but no unallocated left to trash
    throw new BadRequestException(
      'This group has no remaining unallocated sqm to trash (all sold, allocated, or already trashed).',
    );
  }

  return {
    groupKey,
    itemName: nameKey,
    thicknessKey,
    matchedLinesCount,
    trashedPiecesSqm, // 0 in this mode
    trashedUnallocatedSqm,
    totalTrashedSqm: trashedUnallocatedSqm,
  };
}


// ========================================
// Method 1: Restore all trashed unallocated for a group
// ========================================
async restoreAllUnallocatedForGroup(body: { groupKey: string; date?: string | Date }) {
  const groupKey = (body?.groupKey ?? '').trim();
  if (!groupKey) {
    throw new BadRequestException('groupKey is required.');
  }

  const [thicknessKeyRaw, ...nameParts] = groupKey.split('|');
  const thicknessKey = (thicknessKeyRaw ?? '').trim();
  const nameKey = nameParts.join('|').trim(); // in case itemName ever contains '|'

  // Load all BOSTS transfers + items + pieces
  const transfers = await this.transferRepo.find({
    where: { location: 'BOSTS' as any },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemBatch.itemVariant',
      'items.itemBatch.itemVariant.thickness',
      'items.itemBatch.itemVariant.thickness.item',
      'items.sqmPieces',
    ],
    order: { id: 'DESC' },
  });

  let matchedLinesCount = 0;
  let restoredUnallocatedSqm = 0;

  for (const t of transfers) {
    for (const ti of t.items || []) {
      const variant = ti.itemBatch?.itemVariant;
      const thickness = variant?.thickness;
      const item = thickness?.item;

      // build row key exactly like grouping
      const rowThickness =
        thickness?.thickness != null ? String(num(thickness.thickness)) : '';
      const rowName = (item?.itemName ?? '').trim();
      const rowKey = `${rowThickness}|${rowName}`;

      if (rowKey !== groupKey) continue;

      matchedLinesCount++;

      // how much unallocated sqm is currently in "trashed" bucket for this line
      const trashedUnalloc = num((ti as any).sqmTrashUnallocated ?? 0);
      if (trashedUnalloc <= 0.0001) continue;

      // ✅ restore ALL trashed unallocated sqm for this line
      // This will create positive inventory transactions inside restoreUnallocatedForLine
      await this.restoreUnallocatedForLine(ti.id, {
        sqmToRestore: trashedUnalloc,
        date: body?.date,
      });

      restoredUnallocatedSqm += trashedUnalloc;
    }
  }

  if (!matchedLinesCount) {
    throw new NotFoundException(
      `No BOSTS lines found for groupKey="${groupKey}".`,
    );
  }

  if (restoredUnallocatedSqm <= 0.0001) {
    throw new BadRequestException(
      'This group has no trashed unallocated sqm to restore.',
    );
  }

  return {
    groupKey,
    itemName: nameKey,
    thicknessKey,
    matchedLinesCount,
    restoredUnallocatedSqm,
    totalRestoredSqm: restoredUnallocatedSqm,
  };
}

// ========================================
// Method 2: Restore unallocated for a single line
// ========================================



 /**
   * POS search: list SQM pieces that can be sold from POS.
   * - piece must be active
   * - remaining sqm > 0
   * - belonging to BOSTS transfers
   * - optional search by item / origin / transfer / thickness
   */
// sqm-piece.service.ts



async getPosPieces(opts?: { q?: string; onlyRemaining?: boolean }) {
  const qRaw = (opts?.q ?? '').trim();
  const onlyRemaining = opts?.onlyRemaining !== false; // default true

  const qb = this.sqmPieceRepo
    .createQueryBuilder('p')
    .innerJoin('p.sqmVariant', 'v')
    .innerJoin('v.thickness', 'th')
    .innerJoin('th.item', 'it')
    .innerJoin('p.transferItem', 'ti')
    .innerJoin('ti.transfer', 'tr')
    .select([
      'p.id AS id',
      'p.sqmVariantId AS sqmVariantId',
      'p.sqmBatchId AS sqmBatchId',
      'it.itemName AS itemName',
      'th.thickness AS thickness',
      'tr.transferNumber AS transferNumber',
      'p.length AS length',
      'p.width AS width',
      'p.sqmRemaining AS sqmRemaining',
      // piecesRemaining = floor(sqmRemaining * 10000 / (L * W))
      `CASE 
         WHEN p.length > 0 AND p.width > 0 
           THEN FLOOR(p.sqmRemaining * 10000 / (p.length * p.width)) 
         ELSE 0 
       END AS piecesRemaining`,
    ])
    .where('p.isActive = 1');

  if (onlyRemaining) {
    qb.andWhere('p.sqmRemaining > 0');
  }

  if (qRaw) {
    qb.andWhere(
      `(it.itemName LIKE :q OR tr.transferNumber LIKE :q OR th.thickness LIKE :q)`,
      { q: `%${qRaw}%` },
    );
  }

  qb.orderBy('it.itemName', 'ASC')
    .addOrderBy('th.thickness', 'ASC')
    .addOrderBy('tr.transferNumber', 'DESC')
    .addOrderBy('p.id', 'ASC');

  const rows = await qb.getRawMany();

  return rows.map((r) => {
    const thickness =
      r.thickness != null ? String(Number(r.thickness)) : '';
    const label =
      (thickness ? `${thickness}ملم ` : '') + (r.itemName ?? '');

    const piecesRemaining = Number(r.piecesRemaining ?? 0);

    return {
      id: r.id, // SqmPiece id
      // ✅ these are what the POS / invoice needs:
      itemVariantId: Number(r.sqmVariantId),
      itemBatchId: Number(r.sqmBatchId),

      itemName: r.itemName,
      thickness: r.thickness,
      transferNumber: r.transferNumber,
      length: Number(r.length),
      width: Number(r.width),
      sqmRemaining: Number(r.sqmRemaining),
      piecesRemaining,
      label,
      type: 'sqm', // <- mark it as sqm line
    };
  });
}
}