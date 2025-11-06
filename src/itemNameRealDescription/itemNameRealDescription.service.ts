import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RealDescription } from '../entities/inventory/itemNameRealDescription.entity';
import { ItemVariant } from 'src/entities/inventory/itemVariant.entity';

@Injectable()
export class RealDescriptionsService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(RealDescription)
    private readonly realDescRepo: Repository<RealDescription>,
    @InjectRepository(ItemVariant)
    private readonly itemVariantRepo: Repository<ItemVariant>,
  ) {}

  /** GET /real-descriptions?q=&withCounts= */
  async listSorted(opts: { q?: string; withCounts?: boolean }) {
    const qb = this.realDescRepo
      .createQueryBuilder('r')
      .select([
        'r.id',
        'r.itemNumber',
        'r.categoryName',
        'r.subCategory',
        'r.colorName',
        'r.designName',
        'r.sort_index_real_description',
      ])
      // non-null first (0), nulls last (1), then numeric ASC
      .addOrderBy('CASE WHEN r.sort_index_real_description IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('r.sort_index_real_description', 'ASC')
      // readable secondary ordering
      .addOrderBy(
        `CONCAT(
           COALESCE(r.categoryName,''),'|',
           COALESCE(r.subCategory,''),'|',
           COALESCE(r.colorName,''),'|',
           COALESCE(r.designName,''),'|',
           COALESCE(r.itemNumber,'')
         )`,
        'ASC',
      );

    if (opts.q) {
      qb.andWhere(
        `CONCAT(
           COALESCE(r.categoryName,''),' ',
           COALESCE(r.subCategory,''),' ',
           COALESCE(r.colorName,''),' ',
           COALESCE(r.designName,''),' ',
           COALESCE(r.itemNumber,'')
         ) LIKE :q`,
        { q: `%${opts.q}%` },
      );
    }

    const rows = await qb.getMany();
    if (!opts.withCounts) return rows;

    // Count how many variants reference each real description
    const counts = await this.itemVariantRepo
      .createQueryBuilder('v')
      .select('v.realDescriptionId', 'descId')
      .addSelect('COUNT(1)', 'cnt')
      .where('v.realDescriptionId IS NOT NULL')
      .groupBy('v.realDescriptionId')
      .getRawMany<{ descId: number; cnt: string }>();

    const map = new Map<number, number>();
    for (const r of counts) map.set(Number(r.descId), Number(r.cnt));

    return rows.map((r) => ({
      ...r,
      variantsCount: map.get(r.id) ?? 0,
    }));
  }

  /** PUT /real-descriptions/reorder  body: { order: number[] } */
  async reorder(order?: any) {
    if (!Array.isArray(order) || order.length === 0) {
      throw new BadRequestException('Body must be { order: number[] } with at least one id.');
    }

    const ids = order.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    const unique = Array.from(new Set(ids));
    if (unique.length !== ids.length) {
      throw new BadRequestException('Order array contains duplicates or invalid values.');
    }

    const existing = await this.realDescRepo.find({ select: ['id'], where: { id: In(unique) } });
    const existingIds = new Set(existing.map((e) => e.id));
    const missing = unique.filter((id) => !existingIds.has(id));
    if (missing.length) {
      throw new BadRequestException(`These IDs do not exist: ${missing.join(', ')}`);
    }

    await this.ds.transaction(async (manager) => {
      const cases = unique.map((id, idx) => `WHEN ${id} THEN ${idx + 1}`).join(' ');
      await manager
        .createQueryBuilder()
        .update(RealDescription)
        .set({
          // exact column name in entity
          sort_index_real_description: () => `CASE id ${cases} END` as any,
        })
        .where('id IN (:...ids)', { ids: unique })
        .execute();
    });
  }

  /** POST /real-descriptions  (no DTO) */
  async create(body: any) {
    const ent = this.realDescRepo.create({
      categoryName: String(body?.categoryName ?? '').trim(),
      subCategory: String(body?.subCategory ?? '').trim(),
      colorName: String(body?.colorName ?? '').trim(),
      designName: String(body?.designName ?? '').trim(),
      itemNumber: body?.itemNumber ? String(body.itemNumber).trim() : null,
      sort_index_real_description:
        Number.isInteger(Number(body?.sort_index_real_description))
          ? Number(body.sort_index_real_description)
          : null,
    });
    return this.realDescRepo.save(ent);
  }

  /** GET /real-descriptions/:id */
  async getOne(id: number) {
    const ent = await this.realDescRepo.findOne({ where: { id } });
    if (!ent) throw new NotFoundException(`RealDescription ${id} not found`);
    return ent;
  }

  /** PUT /real-descriptions/:id  (no DTO) */
  async update(id: number, body: any) {
    const ent = await this.getOne(id);

    ent.categoryName = body?.categoryName != null ? String(body.categoryName).trim() : ent.categoryName;
    ent.subCategory  = body?.subCategory  != null ? String(body.subCategory).trim()  : ent.subCategory;
    ent.colorName    = body?.colorName    != null ? String(body.colorName).trim()    : ent.colorName;
    ent.designName   = body?.designName   != null ? String(body.designName).trim()   : ent.designName;
    ent.itemNumber   = body?.itemNumber   != null ? String(body.itemNumber).trim()   : ent.itemNumber;

    if (body?.sort_index_real_description !== undefined) {
      const n = Number(body.sort_index_real_description);
      ent.sort_index_real_description = Number.isInteger(n) ? n : null;
    }

    return this.realDescRepo.save(ent);
  }

  /** DELETE /real-descriptions/:id */
  async remove(id: number) {
    const ent = await this.realDescRepo.findOne({ where: { id } });
    if (!ent) throw new NotFoundException(`RealDescription ${id} not found`);

    // Optional safety: prevent delete if variants still reference it
    const stillUsed = await this.itemVariantRepo.count({ where: { realDescriptionId: id } });
    if (stillUsed > 0) {
      throw new BadRequestException(`Cannot delete: ${stillUsed} variant(s) still reference this real description.`);
    }

    await this.realDescRepo.remove(ent);
    return { deleted: true };
  }
}
