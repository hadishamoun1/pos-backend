import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
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
  @Get('v1/combined')
  async getCombinedAccounts(): Promise<any[]> {
    return this.accountsService.getCombinedAccounts();
  }
  @Get('v1/acc-arranged')
  async getAccounts() {
    return this.accountsService.getCombinedAccounts();
  }
  @Get('v1/acc-flat-arranged')
  async getFlatSimplifiedAccounts(): Promise<any[]> {
    return this.accountsService.getFlatSimplifiedAccounts();
  }

  // accounts.controller.ts
 @Get('v1/jv/search')
  async search(
    @Query('q') q: string,
    @Query('type') type?: 'account' | 'customer' | 'supplier',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    data: Array<{
      id: number;
      accountNumber: string;
      accountName: string;
      kind: 'account' | 'customer' | 'supplier';
      parentAccountNumber?: string;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const pg = Math.max(1, Number(page) || 1);
    const lm = Math.max(1, Math.min(200, Number(limit) || 50));
    const res = await this.accountsService.searchCombinedAccounts(q || '', type as any, pg, lm);

    // Return a plain structural type (no UnifiedRow)
    return {
      data: res.data.map(r => ({
        id: r.id,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        kind: r.kind,
        parentAccountNumber: r.parentAccountNumber,
      })),
      page: res.page,
      limit: res.limit,
      total: res.total,
    };
  }

}
