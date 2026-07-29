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
}
