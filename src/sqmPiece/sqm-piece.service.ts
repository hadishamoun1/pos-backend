// src/sqm-pieces/sqm-pieces.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SqmPiece } from '../entities/inventory/sqmPiece.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { Transfer } from '../entities/inventory/transfer.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Thickness } from '../entities/inventory/thickness.entity';

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

    @InjectRepository(ItemBatch)
    private readonly batchRepo: Repository<ItemBatch>,

    @InjectRepository(ItemVariant)
    private readonly variantRepo: Repository<ItemVariant>,

    @InjectRepository(Thickness)
    private readonly thicknessRepo: Repository<Thickness>,
  ) {}

  /**
   * List all BOSTS transfer lines with their total sqm, allocated sqm, and remaining sqm.
   * This powers the main "Sqm Pieces" page.
   */
  async listBostsLines() {
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

        const totalSqm = num(ti.sqm);
        const allocatedSqm = (ti.sqmPieces || []).reduce(
          (sum, p) => sum + num(p.sqmTotal),
          0,
        );
        const remainingSqm = totalSqm - allocatedSqm;

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
          totalSqm,
          allocatedSqm,
          remainingSqm,
        });
      }
    }

    return lines;
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

    const totalSqm = num(ti.sqm);
    const allocatedSqm = (ti.sqmPieces || []).reduce(
      (sum, p) => sum + num(p.sqmTotal),
      0,
    );
    const remainingSqm = totalSqm - allocatedSqm;

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
        totalSqm,
        allocatedSqm,
        remainingSqm,
      },
      pieces: (ti.sqmPieces || []).map((p) => ({
        id: p.id,
        length: Number(p.length),
        width: Number(p.width),
        piecesCount: p.piecesCount,
        sqmTotal: Number(p.sqmTotal),
        sqmSold: Number(p.sqmSold),
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

      // 1) compute total sqm requested by user for this line
      let sumPiecesSqm = 0;
      for (const row of piecesInput) {
        const L = num(row.length);
        const W = num(row.width);
        const count = Math.max(0, Math.floor(num(row.count)));
        const sqmPerPiece = (L * W) / 10000;
        const sqmTotal = count * sqmPerPiece;
        sumPiecesSqm += sqmTotal;
      }

      if (sumPiecesSqm - totalSqmLine > 0.0001) {
        throw new BadRequestException(
          `Allocated sqm (${sumPiecesSqm.toFixed(
            4,
          )}) exceeds line sqm (${totalSqmLine.toFixed(4)}).`,
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

      // 4) delete old pieces for this line
      await manager.getRepository(SqmPiece).delete({ transferItemId });

      // 5) insert new pieces
      const toInsert: SqmPiece[] = [];

      for (const row of piecesInput) {
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
}
