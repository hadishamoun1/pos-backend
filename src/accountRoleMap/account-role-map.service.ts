import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountRoleMap } from '../entities/accountRoleMap.entity';

type CreateBody = {
  role: string;
  currencyCode?: string | null;
  accountNumber: string;
};

type UpdateBody = Partial<CreateBody>;

@Injectable()
export class AccountRoleMapService {
  constructor(
    @InjectRepository(AccountRoleMap)
    private readonly repo: Repository<AccountRoleMap>,
  ) {}

  private normStr(v: any) {
    return String(v ?? '').trim();
  }

  private normCurrency(code?: string | null) {
    const c = this.normStr(code).toUpperCase();
    return c.length ? c : null;
  }

  async create(body: CreateBody) {
    const role = this.normStr(body?.role);
    const accountNumber = this.normStr(body?.accountNumber);
    const currencyCode = this.normCurrency(body?.currencyCode ?? null);

    if (!role) throw new BadRequestException('role is required');
    if (!accountNumber) throw new BadRequestException('accountNumber is required');

    const exists = await this.repo.findOne({ where: { role, currencyCode } as any });
    if (exists) {
      throw new BadRequestException(
        `Role "${role}" already mapped${currencyCode ? ` for ${currencyCode}` : ''}`,
      );
    }

    const row = this.repo.create({ role, currencyCode, accountNumber });
    return this.repo.save(row);
  }

  async findAll(filter?: { role?: string; currencyCode?: string | null }) {
    const role = filter?.role ? this.normStr(filter.role) : undefined;
    const currencyCode =
      filter?.currencyCode !== undefined ? this.normCurrency(filter.currencyCode) : undefined;

    const where: any = {};
    if (role) where.role = role;
    if (currencyCode !== undefined) where.currencyCode = currencyCode;

    return this.repo.find({
      where,
      order: { role: 'ASC', currencyCode: 'ASC' as any, id: 'ASC' },
    });
  }

  async findOne(id: number) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`AccountRoleMap ${id} not found`);
    return row;
  }

  async update(id: number, body: UpdateBody) {
    const row = await this.findOne(id);

    if (body.role !== undefined) {
      const role = this.normStr(body.role);
      if (!role) throw new BadRequestException('role cannot be empty');
      row.role = role;
    }

    if (body.currencyCode !== undefined) {
      row.currencyCode = this.normCurrency(body.currencyCode);
    }

    if (body.accountNumber !== undefined) {
      const accountNumber = this.normStr(body.accountNumber);
      if (!accountNumber) throw new BadRequestException('accountNumber cannot be empty');
      row.accountNumber = accountNumber;
    }

    // prevent duplicates after update
    const dup = await this.repo.findOne({
      where: { role: row.role, currencyCode: row.currencyCode } as any,
    });
    if (dup && dup.id !== id) {
      throw new BadRequestException(
        `Role "${row.role}" already mapped${row.currencyCode ? ` for ${row.currencyCode}` : ''}`,
      );
    }

    return this.repo.save(row);
  }

  async remove(id: number) {
    const row = await this.findOne(id);
    await this.repo.remove(row);
    return { deleted: true, id };
  }
}
