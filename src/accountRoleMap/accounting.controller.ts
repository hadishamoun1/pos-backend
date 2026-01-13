import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { AccountRoleMapService } from './account-role-map.service';
import { AccountingResolverService } from './accounting-resolver.service';

@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly roleMapService: AccountRoleMapService,
    private readonly resolver: AccountingResolverService,
  ) {}

  // ----------------------------
  // Role Map CRUD (no DTO)
  // ----------------------------
  @Post('account-roles')
  create(
    @Body()
    body: {
      role: string;
      currencyCode?: string | null;
      accountNumber: string;
    },
  ) {
    return this.roleMapService.create(body);
  }

  @Get('account-roles')
  findAll(@Query('role') role?: string, @Query('currencyCode') currencyCode?: string) {
    return this.roleMapService.findAll({
      role,
      currencyCode: currencyCode ?? undefined,
    });
  }

  @Get('account-roles/:id')
  findOne(@Param('id') id: string) {
    return this.roleMapService.findOne(Number(id));
  }

  @Put('account-roles/:id')
  update(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      role: string;
      currencyCode: string | null;
      accountNumber: string;
    }>,
  ) {
    return this.roleMapService.update(Number(id), body);
  }

  @Delete('account-roles/:id')
  remove(@Param('id') id: string) {
    return this.roleMapService.remove(Number(id));
  }

  // ----------------------------
  // Resolver test endpoint
  // ----------------------------
  // GET /accounting/resolve?role=SALES_VAT&currencyCode=USD
  @Get('resolve')
  async resolve(@Query('role') role: string, @Query('currencyCode') currencyCode?: string) {
    const acc = await this.resolver.resolveAccount(role, currencyCode ?? null);
    return {
      role,
      currencyCode: currencyCode ?? null,
      account: {
        id: (acc as any).id,
        accountNumber: (acc as any).accountNumber,
        accountName: (acc as any).accountName,
        arabicAccountName: (acc as any).arabicAccountName,
        parentNumber: (acc as any).parentNumber,
      },
    };
  }
}
