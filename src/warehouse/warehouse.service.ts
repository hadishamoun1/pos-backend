import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Warehouse } from "../entities/warehouse.entity";
import { ItemBatch } from "../entities/inventory/itemBatch.entity";

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly repo: Repository<Warehouse>,
    @InjectRepository(ItemBatch)
    private readonly batchRepo: Repository<ItemBatch>,
  ) {}

  findAll(): Promise<Warehouse[]> {
    return this.repo.find({ order: { isHome: "DESC", name: "ASC" } });
  }

  async create(name: string): Promise<Warehouse> {
    const exists = await this.repo.findOne({ where: { name } });
    if (exists) throw new ConflictException(`Warehouse "${name}" already exists`);
    const wh = this.repo.create({ name, isHome: false });
    return this.repo.save(wh);
  }

  async setHome(id: number): Promise<Warehouse> {
    const wh = await this.repo.findOne({ where: { id } });
    if (!wh) throw new NotFoundException(`Warehouse #${id} not found`);
    await this.repo.update({}, { isHome: false });
    await this.repo.update(id, { isHome: true });
    return this.repo.findOne({ where: { id } });
  }

  async update(id: number, name: string): Promise<Warehouse> {
    const wh = await this.repo.findOne({ where: { id } });
    if (!wh) throw new NotFoundException(`Warehouse #${id} not found`);
    await this.repo.update(id, { name });
    return this.repo.findOne({ where: { id } });
  }

  async remove(id: number): Promise<void> {
    const wh = await this.repo.findOne({ where: { id } });
    if (!wh) throw new NotFoundException(`Warehouse #${id} not found`);
    await this.repo.delete(id);
  }

  async migrateBatches(): Promise<{ updated: number; homeName: string }> {
    const home = await this.repo.findOne({ where: { isHome: true } });
    if (!home) throw new NotFoundException("No home warehouse set. Please set a home warehouse first.");
    const result = await this.batchRepo
      .createQueryBuilder()
      .update()
      .set({ warehouse: home.name })
      .where("warehouse = :old OR warehouse IS NULL", { old: "Shamoun" })
      .execute();
    return { updated: result.affected ?? 0, homeName: home.name };
  }

  async getStockPanel(params?: {
    emptyOnly?: boolean;
    warehouse?: string;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params?.page ?? 1));
    const limit = Math.min(500, Math.max(1, Number(params?.limit ?? 200)));

    const qb = this.batchRepo
      .createQueryBuilder("b")
      .leftJoinAndSelect("b.itemVariant", "v")
      .leftJoinAndSelect("v.thickness", "th")
      .leftJoinAndSelect("th.item", "item")
      .leftJoinAndSelect("v.itemNameDescription", "desc")
      // only rows that actually carry stock — skip fully-drained batches
      .andWhere("(b.balance <> 0 OR b.balanceOFR <> 0)")
      .orderBy("b.id", "DESC");

    if (params?.emptyOnly) {
      qb.andWhere("b.warehouse IS NULL");
    } else if (params?.warehouse) {
      qb.andWhere("b.warehouse = :warehouse", { warehouse: params.warehouse });
    }

    if (params?.q?.trim()) {
      const like = `%${params.q.trim()}%`;
      qb.andWhere(
        "(desc.name LIKE :like OR desc.description LIKE :like OR v.invoiceDisplayName LIKE :like)",
        { like },
      );
    }

    const [rows, total] = await qb
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    const data = rows.map((b) => {
      const v: any = b.itemVariant;
      const item = v?.thickness?.item;
      const desc = v?.itemNameDescription;
      return {
        batchId: b.id,
        itemVariantId: v?.id ?? null,
        itemName: desc?.name ?? desc?.description ?? v?.invoiceDisplayName ?? null,
        type: item?.type ?? null,
        stockMode: item?.stockMode ?? null,
        thickness: v?.thickness?.thickness != null ? Number(v.thickness.thickness) : null,
        length: Number(v?.length || 0),
        width: Number(v?.width || 0),
        sheetsPerBox: Number(v?.sheetsPerBox || 0),
        origin: v?.origin ?? null,
        condition: b.condition,
        dateReceived: b.dateReceived,
        warehouse: b.warehouse,
        balance: Number(b.balance || 0),
        balanceOFR: Number(b.balanceOFR || 0),
      };
    });

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async setBatchWarehouse(batchId: number, warehouse: string | null): Promise<ItemBatch> {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch #${batchId} not found`);

    if (warehouse) {
      const wh = await this.repo.findOne({ where: { name: warehouse } });
      if (!wh) throw new NotFoundException(`Warehouse "${warehouse}" does not exist`);
    }

    batch.warehouse = warehouse;
    return this.batchRepo.save(batch);
  }
}
