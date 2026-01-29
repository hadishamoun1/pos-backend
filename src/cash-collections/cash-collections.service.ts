// src/cash-collections/cash-collections.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Brackets } from "typeorm";
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

  async create(body: any, employeeId: number) {
    const date = String(body?.date || "").trim() || toYmd(new Date());
    const customerId = Number(body?.customerId);
    const amountNum = Number(body?.amount);

    const currencyId =
      body?.currencyId === null || body?.currencyId === undefined || body?.currencyId === ""
        ? null
        : Number(body?.currencyId);

    const method = String(body?.method || "CASH").toUpperCase();
    const reference = body?.reference ? String(body.reference).trim() : null;
    const notes = body?.notes ? String(body.notes).trim() : null;

    if (!customerId || !Number.isFinite(customerId))
      throw new BadRequestException("customerId is required");
    if (!Number.isFinite(amountNum) || amountNum <= 0)
      throw new BadRequestException("amount must be > 0");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException("date must be YYYY-MM-DD");
    if (!["CASH", "WHISH", "CHEQUE", "OTHER"].includes(method))
      throw new BadRequestException("invalid method");

    const row = this.repo.create({
      date,
      customerId,
      employeeId,
      amount: amountNum.toFixed(2),
      currencyId: currencyId ?? null,
      method: method as any,
      reference,
      notes,
      isPosted: false,
    });

    return this.repo.save(row);
  }

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

    const sortBy = ["date", "createdAt", "amount"].includes(query?.sortBy)
      ? query.sortBy
      : "date";
    const sortDir = String(query?.sortDir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

    const qb = this.repo
      .createQueryBuilder("cc")
      .leftJoinAndSelect("cc.customer", "customer")
      .leftJoinAndSelect("cc.employee", "employee")
      .leftJoinAndSelect("cc.currency", "currency");

    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) qb.andWhere("cc.date >= :from", { from });
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) qb.andWhere("cc.date <= :to", { to });

    if (employeeId && Number.isFinite(employeeId))
      qb.andWhere("cc.employeeId = :employeeId", { employeeId });

    if (customerId && Number.isFinite(customerId))
      qb.andWhere("cc.customerId = :customerId", { customerId });

    // currencyId can be null => show only rows with null currency
    if (query?.currencyId !== undefined) {
      if (currencyId === null) qb.andWhere("cc.currencyId IS NULL");
      else if (Number.isFinite(currencyId)) qb.andWhere("cc.currencyId = :currencyId", { currencyId });
    }

    if (method && ["CASH", "WHISH", "CHEQUE", "OTHER"].includes(method))
      qb.andWhere("cc.method = :method", { method });

    if (q) {
      qb.andWhere(
        new Brackets((w) => {
          w.where("customer.name LIKE :q", { q: `%${q}%` })
            .orWhere("cc.reference LIKE :q", { q: `%${q}%` })
            .orWhere("cc.notes LIKE :q", { q: `%${q}%` });
        })
      );
    }

    qb.orderBy(`cc.${sortBy}`, sortDir as any).skip(skip).take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      page,
      limit,
      total,
      rows,
    };
  }

async getOne(id: number) {
  const row = await this.repo.findOne({ where: { id } });
  if (!row) throw new BadRequestException("not found");
  return row;
}


  async remove(id: number) {
    if (!id) throw new BadRequestException("id required");
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new BadRequestException("not found");
    if (row.isPosted) throw new BadRequestException("cannot delete posted collection");
    await this.repo.delete(id);
    return { ok: true };
  }
}
