import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { AlternativeCustomer } from '../entities/alternative-customer.entity';

@Injectable()
export class AlternativeCustomerService {
  constructor(
    @InjectRepository(AlternativeCustomer)
    private readonly alternativeCustomerRepo: Repository<AlternativeCustomer>,
  ) {}

  async findAll(): Promise<AlternativeCustomer[]> {
    return this.alternativeCustomerRepo.find({ order: { company: 'ASC' } });
  }

  async search(query: string): Promise<AlternativeCustomer[]> {
    if (!query?.trim()) return [];

    const q = `%${query.trim()}%`;

    return this.alternativeCustomerRepo.find({
      where: { company: Like(q) },
      take: 10,
    });
  }

  async bulkImport(
    rows: Array<{
      company: string;
      businessPhone?: string;
      address?: string;
      areaDescription?: string;
    }>,
  ): Promise<{ inserted: number; skipped: number }> {
    const cleaned = rows
      .map((r) => ({
        company: (r.company || '').trim(),
        businessPhone: (r.businessPhone || '').trim() || null,
        address: (r.address || '').trim() || null,
        areaDescription: (r.areaDescription || '').trim() || null,
      }))
      .filter((r) => r.company.length > 0);

    if (!cleaned.length) return { inserted: 0, skipped: 0 };

    const existing = await this.alternativeCustomerRepo.find({
      select: ['company', 'businessPhone'],
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.company}||${e.businessPhone || ''}`),
    );

    const toInsert = [];
    let skipped = 0;

    for (const row of cleaned) {
      const key = `${row.company}||${row.businessPhone || ''}`;
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }
      existingKeys.add(key);
      toInsert.push(row);
    }

    if (toInsert.length) {
      await this.alternativeCustomerRepo.save(
        this.alternativeCustomerRepo.create(toInsert),
      );
    }

    return { inserted: toInsert.length, skipped };
  }
}
