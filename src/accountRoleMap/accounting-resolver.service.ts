import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { AccountRoleMap } from '../entities/accountRoleMap.entity';

@Injectable()
export class AccountingResolverService {
  constructor(
    @InjectRepository(AccountRoleMap)
    private readonly roleRepo: Repository<AccountRoleMap>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  private normStr(v: any) {
    return String(v ?? '').trim();
  }

  private normCurrency(code?: string | null) {
    const c = this.normStr(code).toUpperCase();
    return c.length ? c : null;
  }

  /**
   * Resolve account by role + optional currencyCode.
   * Order:
   *  1) (role + currencyCode)
   *  2) (role + NULL currencyCode) default
   */
  async resolveAccount(role: string, currencyCode?: string | null): Promise<Account> {
    const r = this.normStr(role);
    if (!r) throw new NotFoundException('Role is required');

    const c = this.normCurrency(currencyCode);

    let map: AccountRoleMap | null = null;

    if (c) {
      map = await this.roleRepo.findOne({ where: { role: r, currencyCode: c } as any });
    }
    if (!map) {
      map = await this.roleRepo.findOne({ where: { role: r, currencyCode: null } as any });
    }
    if (!map) {
      throw new NotFoundException(
        `Accounting role "${r}" not configured${c ? ` for ${c}` : ''}`,
      );
    }

    const acc = await this.accountRepo.findOneBy({ accountNumber: map.accountNumber });
    if (!acc) {
      throw new NotFoundException(
        `Account "${map.accountNumber}" (role="${r}") not found in accounts table`,
      );
    }

    return acc;
  }
}
