import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Warehouse } from "../entities/warehouse.entity";

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly repo: Repository<Warehouse>
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
}
