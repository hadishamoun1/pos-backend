// src/inventory-audit/inventory-audit.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { DataSource, In } from 'typeorm';

export type AuditRow = {
  itemVariantId: number;

  ledgerStartOFR: number;
  ledgerInOFR: number;
  ledgerOutOFR: number; 
  ledgerBalanceOFR: number;

  cachedStartOFR: number;
  cachedInOFR: number;
  cachedOutOFR: number; 
  cachedBalanceOFR: number;

  diffStartOFR: number;
  diffInOFR: number;
  diffOutOFR: number;
  diffBalanceOFR: number;

  cachedBalanceFormulaOFR: number; 
  diffCachedBalanceFormulaOFR: number; 

  isMismatch: boolean;
};

export type AuditQuery = {
  variantId?: number;
  onlyMismatch?: boolean; 
  tolerance?: number; 
  limit?: number;
  offset?: number; 
};

function num(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function abs(n: number): number {
  return n < 0 ? -n : n;
}

@Injectable()
export class InventoryAuditService {

  constructor(
    @InjectRepository(ItemVariant)
    private readonly variantRepo: Repository<ItemVariant>,

    @InjectRepository(InventoryTransaction)
    private readonly txRepo: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource
  ) {}
async auditOfrAll(query: { tolerance?: number; variantId?: number }) {
  const tolerance = Number.isFinite(Number(query.tolerance)) ? Number(query.tolerance) : 0.01;
  const variantId = query.variantId ? Number(query.variantId) : 0;

  // --- Ledger (InventoryTransaction.sqmofr) ---
  // Opening count is START (inventoryCountId != null)
  const startExpr = `
    COALESCE(
      SUM(
        CASE
          WHEN tx.inventoryCountId IS NOT NULL THEN COALESCE(tx.sqmofr,0)
          ELSE 0
        END
      ),
    0)`;

  // Purchases / positive movements (excluding count)
  const inExpr = `
    COALESCE(
      SUM(
        CASE
          WHEN tx.inventoryCountId IS NULL AND COALESCE(tx.sqmofr,0) > 0 THEN COALESCE(tx.sqmofr,0)
          ELSE 0
        END
      ),
    0)`;

  // Sales / negative movements -> store as positive magnitude OUT
  const outExpr = `
    COALESCE(
      SUM(
        CASE
          WHEN tx.inventoryCountId IS NULL AND COALESCE(tx.sqmofr,0) < 0 THEN -COALESCE(tx.sqmofr,0)
          ELSE 0
        END
      ),
    0)`;

  // --- Cached (ItemVariant totals) ---
  // ✅ Use MAX() so MySQL allows them inside HAVING with GROUP BY
  const cStart = `COALESCE(MAX(iv.totalStartOFR),0)`;
  const cIn = `COALESCE(MAX(iv.totalInOFR),0)`;
  const cOut = `COALESCE(MAX(iv.totalOutOFR),0)`;
  const cBal = `COALESCE(MAX(iv.totalBalanceOFR),0)`;

  const ledgerBalExpr = `(${startExpr} + ${inExpr} - ${outExpr})`;
  const cachedFormulaExpr = `(${cStart} + ${cIn} - ${cOut})`;

  const qb = this.variantRepo.createQueryBuilder("iv")
    // ledger tx join
    .leftJoin("inventory_transaction", "tx", "tx.itemVariantId = iv.id")
    // ✅ join thickness + item
    .leftJoin("iv.thickness", "th")
    .leftJoin("th.item", "it")
    // selects
    .select("iv.id", "itemVariantId")
    .addSelect(`COALESCE(MAX(it.itemName), '')`, "itemName")
    .addSelect(`COALESCE(MAX(th.thickness), 0)`, "thicknessMm")

    .addSelect(startExpr, "ledgerStartOFR")
    .addSelect(inExpr, "ledgerInOFR")
    .addSelect(outExpr, "ledgerOutOFR")
    .addSelect(ledgerBalExpr, "ledgerBalanceOFR")

    .addSelect(cStart, "cachedStartOFR")
    .addSelect(cIn, "cachedInOFR")
    .addSelect(cOut, "cachedOutOFR")
    .addSelect(cBal, "cachedBalanceOFR")

    .addSelect(`(${startExpr} - ${cStart})`, "diffStartOFR")
    .addSelect(`(${inExpr} - ${cIn})`, "diffInOFR")
    .addSelect(`(${outExpr} - ${cOut})`, "diffOutOFR")
    .addSelect(`(${ledgerBalExpr} - ${cBal})`, "diffBalanceOFR")

    .addSelect(cachedFormulaExpr, "cachedBalanceFormulaOFR")
    .addSelect(`(${cBal} - ${cachedFormulaExpr})`, "diffCachedBalanceFormulaOFR")

    .groupBy("iv.id");

  if (variantId > 0) {
    qb.andWhere("iv.id = :vid", { vid: variantId });
  }

  // ✅ Only return mismatches (ghost stock)
  qb.having(
    `
      ABS(${startExpr} - ${cStart}) > :tol
      OR ABS(${inExpr} - ${cIn}) > :tol
      OR ABS(${outExpr} - ${cOut}) > :tol
      OR ABS(${ledgerBalExpr} - ${cBal}) > :tol
      OR ABS(${cBal} - ${cachedFormulaExpr}) > :tol
    `,
    { tol: tolerance }
  );

  qb.orderBy("iv.id", "ASC");

  const raw = await qb.getRawMany();

  return {
    meta: {
      onlyMismatch: true,
      tolerance,
      variantId: variantId || null,
      returned: raw.length,
    },
    rows: raw.map((r: any) => ({
      itemVariantId: Number(r.itemVariantId),

      // ✅ new fields
      itemName: String(r.itemName ?? ""),
      thicknessMm: Number(r.thicknessMm),

      ledgerStartOFR: Number(r.ledgerStartOFR),
      ledgerInOFR: Number(r.ledgerInOFR),
      ledgerOutOFR: Number(r.ledgerOutOFR),
      ledgerBalanceOFR: Number(r.ledgerBalanceOFR),

      cachedStartOFR: Number(r.cachedStartOFR),
      cachedInOFR: Number(r.cachedInOFR),
      cachedOutOFR: Number(r.cachedOutOFR),
      cachedBalanceOFR: Number(r.cachedBalanceOFR),

      diffStartOFR: Number(r.diffStartOFR),
      diffInOFR: Number(r.diffInOFR),
      diffOutOFR: Number(r.diffOutOFR),
      diffBalanceOFR: Number(r.diffBalanceOFR),

      cachedBalanceFormulaOFR: Number(r.cachedBalanceFormulaOFR),
      diffCachedBalanceFormulaOFR: Number(r.diffCachedBalanceFormulaOFR),

      isMismatch: true,
    })),
  };
}


  private toNum(v: any, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  private abs(v: any) {
    const n = this.toNum(v, 0);
    return n < 0 ? -n : n;
  }

  // keep 2 decimals (your columns are scale:2)
  private round2(v: any) {
    const n = this.toNum(v, 0);
    return Math.round(n * 100) / 100;
  }

  private isMismatch(row: any, tol: number) {
    return (
      this.abs(row.diffStartOFR) > tol ||
      this.abs(row.diffInOFR) > tol ||
      this.abs(row.diffOutOFR) > tol ||
      this.abs(row.diffBalanceOFR) > tol ||
      this.abs(row.diffCachedBalanceFormulaOFR) > tol
    );
  }

  async fixGhostStockOfr(body: any) {
    const tolerance = Number.isFinite(Number(body?.tolerance)) ? Number(body.tolerance) : 0.01;
    const dryRun = body?.dryRun === false ? false : true; // default true

    const variantIdsRaw = Array.isArray(body?.variantIds) ? body.variantIds : null;
    const variantIds =
      variantIdsRaw?.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x) && x > 0) ?? null;

    // ---------- Ledger expressions ----------
    const startExpr = `
      COALESCE(
        SUM(
          CASE
            WHEN tx.inventoryCountId IS NOT NULL THEN COALESCE(tx.sqmofr,0)
            ELSE 0
          END
        ),
      0)`;

    const inExpr = `
      COALESCE(
        SUM(
          CASE
            WHEN tx.inventoryCountId IS NULL AND COALESCE(tx.sqmofr,0) > 0 THEN COALESCE(tx.sqmofr,0)
            ELSE 0
          END
        ),
      0)`;

    // negative sqmofr becomes positive OUT magnitude
    const outExpr = `
      COALESCE(
        SUM(
          CASE
            WHEN tx.inventoryCountId IS NULL AND COALESCE(tx.sqmofr,0) < 0 THEN -COALESCE(tx.sqmofr,0)
            ELSE 0
          END
        ),
      0)`;

    // ---------- Cached expressions (MAX for GROUP BY safety) ----------
    const cStart = `COALESCE(MAX(iv.totalStartOFR),0)`;
    const cIn = `COALESCE(MAX(iv.totalInOFR),0)`;
    const cOut = `COALESCE(MAX(iv.totalOutOFR),0)`;
    const cBal = `COALESCE(MAX(iv.totalBalanceOFR),0)`;

    const ledgerBalExpr = `(${startExpr} + ${inExpr} - ${outExpr})`;
    const cachedFormulaExpr = `(${cStart} + ${cIn} - ${cOut})`;

    const variantRepo = this.dataSource.getRepository(ItemVariant);

    // Build one query that returns ledger + cached + itemName + thickness
    const qb = variantRepo
      .createQueryBuilder('iv')
      .leftJoin(InventoryTransaction, 'tx', 'tx.itemVariantId = iv.id')
      .leftJoin('iv.thickness', 'th')
      .leftJoin('th.item', 'it')
      .select('iv.id', 'itemVariantId')
      .addSelect(`COALESCE(MAX(it.itemName), '')`, 'itemName')
      .addSelect(`COALESCE(MAX(th.thickness), 0)`, 'thicknessMm')
      .addSelect(startExpr, 'ledgerStartOFR')
      .addSelect(inExpr, 'ledgerInOFR')
      .addSelect(outExpr, 'ledgerOutOFR')
      .addSelect(ledgerBalExpr, 'ledgerBalanceOFR')
      .addSelect(cStart, 'cachedStartOFR')
      .addSelect(cIn, 'cachedInOFR')
      .addSelect(cOut, 'cachedOutOFR')
      .addSelect(cBal, 'cachedBalanceOFR')
      .addSelect(`(${startExpr} - ${cStart})`, 'diffStartOFR')
      .addSelect(`(${inExpr} - ${cIn})`, 'diffInOFR')
      .addSelect(`(${outExpr} - ${cOut})`, 'diffOutOFR')
      .addSelect(`(${ledgerBalExpr} - ${cBal})`, 'diffBalanceOFR')
      .addSelect(cachedFormulaExpr, 'cachedBalanceFormulaOFR')
      .addSelect(`(${cBal} - ${cachedFormulaExpr})`, 'diffCachedBalanceFormulaOFR')
      .groupBy('iv.id')
      .orderBy('iv.id', 'ASC');

    // If user provided specific variants, query them directly
    if (variantIds && variantIds.length > 0) {
      qb.where('iv.id IN (:...ids)', { ids: variantIds });
    } else {
      // Otherwise, only fetch mismatches directly from DB (all ghost stock)
      qb.having(
        `
          ABS(${startExpr} - ${cStart}) > :tol
          OR ABS(${inExpr} - ${cIn}) > :tol
          OR ABS(${outExpr} - ${cOut}) > :tol
          OR ABS(${ledgerBalExpr} - ${cBal}) > :tol
          OR ABS(${cBal} - ${cachedFormulaExpr}) > :tol
        `,
        { tol: tolerance },
      );
    }

    const raw = await qb.getRawMany();

    const rows = raw.map((r: any) => {
      const ledgerStartOFR = this.round2(r.ledgerStartOFR);
      const ledgerInOFR = this.round2(r.ledgerInOFR);
      const ledgerOutOFR = this.round2(r.ledgerOutOFR);
      const ledgerBalanceOFR = this.round2(r.ledgerBalanceOFR);

      const cachedStartOFR = this.round2(r.cachedStartOFR);
      const cachedInOFR = this.round2(r.cachedInOFR);
      const cachedOutOFR = this.round2(r.cachedOutOFR);
      const cachedBalanceOFR = this.round2(r.cachedBalanceOFR);

      const diffStartOFR = this.round2(r.diffStartOFR);
      const diffInOFR = this.round2(r.diffInOFR);
      const diffOutOFR = this.round2(r.diffOutOFR);
      const diffBalanceOFR = this.round2(r.diffBalanceOFR);

      const cachedBalanceFormulaOFR = this.round2(r.cachedBalanceFormulaOFR);
      const diffCachedBalanceFormulaOFR = this.round2(r.diffCachedBalanceFormulaOFR);

      const row = {
        itemVariantId: Number(r.itemVariantId),
        itemName: String(r.itemName ?? ''),
        thicknessMm: this.round2(r.thicknessMm),

        ledgerStartOFR,
        ledgerInOFR,
        ledgerOutOFR,
        ledgerBalanceOFR,

        cachedStartOFR,
        cachedInOFR,
        cachedOutOFR,
        cachedBalanceOFR,

        diffStartOFR,
        diffInOFR,
        diffOutOFR,
        diffBalanceOFR,

        cachedBalanceFormulaOFR,
        diffCachedBalanceFormulaOFR,
      };

      return { ...row, isMismatch: this.isMismatch(row, tolerance) };
    });

    // If variantIds were provided, filter only true mismatches (so we don't update clean ones)
    const candidates = rows.filter((r) => r.isMismatch);

    if (dryRun) {
      return {
        meta: {
          mode: 'dryRun',
          tolerance,
          requestedVariantIds: variantIds?.length ? variantIds : null,
          returned: rows.length,
          willFix: candidates.length,
        },
        rows: candidates.map((r) => ({
          ...r,
          // what we would set on ItemVariant
          fixTo: {
            totalStartOFR: r.ledgerStartOFR,
            totalInOFR: r.ledgerInOFR,
            totalOutOFR: r.ledgerOutOFR,
            totalBalanceOFR: r.ledgerBalanceOFR,
          },
        })),
      };
    }

    // ✅ Apply updates in a DB transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const r of candidates) {
        await queryRunner.manager.update(
          ItemVariant,
          { id: r.itemVariantId },
          {
            totalStartOFR: r.ledgerStartOFR,
            totalInOFR: r.ledgerInOFR,
            totalOutOFR: r.ledgerOutOFR,
            totalBalanceOFR: r.ledgerBalanceOFR,
          },
        );
      }

      await queryRunner.commitTransaction();

      return {
        meta: {
          mode: 'applied',
          tolerance,
          requestedVariantIds: variantIds?.length ? variantIds : null,
          updated: candidates.length,
          skipped: rows.length - candidates.length,
        },
        rows: candidates.map((r) => ({
          itemVariantId: r.itemVariantId,
          itemName: r.itemName,
          thicknessMm: r.thicknessMm,
          updatedTo: {
            totalStartOFR: r.ledgerStartOFR,
            totalInOFR: r.ledgerInOFR,
            totalOutOFR: r.ledgerOutOFR,
            totalBalanceOFR: r.ledgerBalanceOFR,
          },
        })),
      };
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }
}


