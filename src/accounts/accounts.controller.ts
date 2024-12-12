import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { Account } from '../entities/account.entity';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  async createAccount(@Body() accountData: Partial<Account>): Promise<Account> {
    return this.accountsService.createAccount(accountData);
  }

  @Get()
  async getAllAccounts(): Promise<Account[]> {
    return this.accountsService.getAllAccounts();
  }

  @Get(':id')
  async getAccountById(@Param('id') id: number): Promise<Account> {
    return this.accountsService.getAccountById(id);
  }

  @Put(':id')
  async updateAccount(
    @Param('id') id: number,
    @Body() accountData: Partial<Account>,
  ): Promise<Account> {
    return this.accountsService.updateAccount(id, accountData);
  }

  @Delete(':id')
  async deleteAccount(@Param('id') id: number): Promise<void> {
    return this.accountsService.deleteAccount(id);
  }
}
