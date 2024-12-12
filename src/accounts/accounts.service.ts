import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../entities/account.entity';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  async createAccount(accountData: Partial<Account>): Promise<Account> {
    const account = this.accountRepository.create(accountData);
    return this.accountRepository.save(account);
  }

  async getAccountById(id: number): Promise<Account> {
    return this.accountRepository.findOne({
      where: { id },
      relations: ['parent', 'children'],
    });
  }

  async getAllAccounts(): Promise<Account[]> {
    return this.accountRepository.find({
      relations: ['parent', 'children'],
    });
  }

  async updateAccount(
    id: number,
    accountData: Partial<Account>,
  ): Promise<Account> {
    await this.accountRepository.update(id, accountData);
    return this.getAccountById(id);
  }

  async deleteAccount(id: number): Promise<void> {
    await this.accountRepository.delete(id);
  }
}
