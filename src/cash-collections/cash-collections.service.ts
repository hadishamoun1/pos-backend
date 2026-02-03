// src/cash-collections/cash-collections.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Brackets, In, IsNull } from "typeorm";
import { CashCollection } from "../entities/cash-collection.entity";

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

@Injectable()
export class CashCollectionsService {
  constructor(
    @InjectRepository(CashCollection)
    private readonly repo: Repository<CashCollection>
  ) {}

  /**
   * Create a cash collection row.
   * NOTE: Make sure CashCollection entity + DB have `driverName` column (nullable).
   */
  async create(body: any, employeeId: number) {
    const date = String(body?.date || "").trim() || toYmd(new Date());
    const customerId = Number(body?.customerId);
    const amountNum = Number(body?.amount);

    const currencyId =
      body?.currencyId === null ||
      body?.currencyId === undefined ||
      body?.currencyId === ""
        ? null
        : Number(body?.currencyId);

    const method = String(body?.method || "CASH").toUpperCase();
    const reference = body?.reference ? String(body.reference).trim() : null;
    const notes = body?.notes ? String(body.notes).trim() : null;

    // ✅ NEW: driverName (chauffeur)
    const driverName = body?.driverName ? String(body.driverName).trim() : null;

    if (!customerId || !Number.isFinite(customerId)) {
      throw new BadRequestException("customerId is required");
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new BadRequestException("amount must be > 0");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("date must be YYYY-MM-DD");
    }
    if (!["CASH", "WHISH", "CHEQUE", "OTHER"].includes(method)) {
      throw new BadRequestException("invalid method");
    }

    const row = this.repo.create({
      date,
      customerId,
      employeeId,
      amount: amountNum.toFixed(2),
      currencyId: currencyId ?? null,
      method: method as any,
      reference,
      notes,

      // ✅ NEW
      driverName: driverName || null,

      isPosted: false,

      // ✅ NEW
      receivableEntryId: null,
    });

    return this.repo.save(row);
  }

  /**
   * ✅ NEW:
   * Mark many cash collections as "converted" by linking them to a ReceiptEntry id.
   * This is what prevents duplicates.
   *
   * Rules:
   * - only updates rows where receivableEntryId IS NULL (idempotent)
   * - non-admin can only mark his own rows
   */
  async markReceivableLink(params: {
    ids: number[];
    receivableEntryId: number;
    employeeId: number;
    canViewAny: boolean;
  }) {
    const ids = Array.isArray(params.ids)
      ? params.ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];

    const receivableEntryId = Number(params.receivableEntryId);

    if (!ids.length) throw new BadRequestException("ids[] is required");
    if (!Number.isFinite(receivableEntryId) || receivableEntryId <= 0) {
      throw new BadRequestException("receivableEntryId is required");
    }

    // Update only unlinked rows (idempotent)
    const qb = this.repo
      .createQueryBuilder()
      .update(CashCollection)
      .set({ receivableEntryId, isPosted: true }) 
      .where({ id: In(ids), receivableEntryId: IsNull() });

    // non-admin: only his rows
    if (!params.canViewAny) {
      qb.andWhere("employeeId = :employeeId", { employeeId: params.employeeId });
    }

    const result = await qb.execute();

    return {
      ok: true,
      receivableEntryId,
      requested: ids.length,
      updated: result.affected || 0,
    };
  }

  /**
   * List cash collections with filters + pagination.
   * Supports:
   * - from/to (date range)
   * - employeeId, customerId, currencyId, method
   * - q search across customer.name, reference, notes, driverName
   * - sortBy: date|createdAt|amount
   * - sortDir: ASC|DESC
   *
   * OPTIONAL:
   * - driverName (dedicated filter)
   */
  async list(query: any) {
    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(200, Math.max(10, Number(query?.limit || 50)));
    const skip = (page - 1) * limit;

    const from = query?.from ? String(query.from).trim() : null;
    const to = query?.to ? String(query.to).trim() : null;

    const employeeId = query?.employeeId ? Number(query.employeeId) : null;
    const customerId = query?.customerId ? Number(query.customerId) : null;

    const currencyId =
      query?.currencyId === "" || query?.currencyId === undefined
        ? null
        : query?.currencyId
        ? Number(query.currencyId)
        : null;

    const method = query?.method ? String(query.method).toUpperCase() : null;
    const q = query?.q ? String(query.q).trim() : null;

    // OPTIONAL dedicated driverName filter
    const driverName = query?.driverName ? String(query.driverName).trim() : null;

    const sortBy = ["date", "createdAt", "amount"].includes(query?.sortBy)
      ? query.sortBy
      : "date";
    const sortDir =
      String(query?.sortDir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

    const qb = this.repo
      .createQueryBuilder("cc")
      .leftJoinAndSelect("cc.customer", "customer")
      .leftJoinAndSelect("cc.employee", "employee")
      .leftJoinAndSelect("cc.currency", "currency");

    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      qb.andWhere("cc.date >= :from", { from });
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      qb.andWhere("cc.date <= :to", { to });
    }

    if (employeeId && Number.isFinite(employeeId)) {
      qb.andWhere("cc.employeeId = :employeeId", { employeeId });
    }

    if (customerId && Number.isFinite(customerId)) {
      qb.andWhere("cc.customerId = :customerId", { customerId });
    }

    // currencyId can be null => show only rows with null currency
    if (query?.currencyId !== undefined) {
      if (currencyId === null) qb.andWhere("cc.currencyId IS NULL");
      else if (Number.isFinite(currencyId)) {
        qb.andWhere("cc.currencyId = :currencyId", { currencyId });
      }
    }

    if (method && ["CASH", "WHISH", "CHEQUE", "OTHER"].includes(method)) {
      qb.andWhere("cc.method = :method", { method });
    }

    // OPTIONAL: dedicated driverName filter
    if (driverName) {
      qb.andWhere("cc.driverName LIKE :driverName", { driverName: `%${driverName}%` });
    }

    // q search
    if (q) {
      qb.andWhere(
        new Brackets((w) => {
          w.where("customer.name LIKE :q", { q: `%${q}%` })
            .orWhere("cc.reference LIKE :q", { q: `%${q}%` })
            .orWhere("cc.notes LIKE :q", { q: `%${q}%` })
            // ✅ NEW: search driverName
            .orWhere("cc.driverName LIKE :q", { q: `%${q}%` });
        })
      );
    }

    qb.orderBy(`cc.${sortBy}`, sortDir as any).skip(skip).take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      page,
      limit,
      total,
      rows, // ✅ includes receivableEntryId now
    };
  }

  /**
   * Get one row (with relations) for view/preview modal, etc.
   */
  async getOne(id: number) {
    const row = await this.repo
      .createQueryBuilder("cc")
      .leftJoinAndSelect("cc.customer", "customer")
      .leftJoinAndSelect("cc.employee", "employee")
      .leftJoinAndSelect("cc.currency", "currency")
      .where("cc.id = :id", { id })
      .getOne();

    if (!row) throw new BadRequestException("not found");
    return row;
  }

  /**
   * ✅ UPDATED: Allow deletion even if posted
   * Deletes the cash collection record only.
   * The linked receivable entry (if any) in the receivables table remains intact.
   * This won't affect any posted receivable entries.
   */
  async remove(id: number) {
    if (!id) throw new BadRequestException("id required");
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new BadRequestException("not found");
    
    // ✅ REMOVED the isPosted check
    // Now allows deletion regardless of isPosted status
    // The receivableEntryId link in the receivables table remains (orphaned reference)
    
    await this.repo.delete(id);
    return { ok: true };
  }
}