// src/reports/reports.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /reports/trial-balance
   */
  @Get('trial-balance')
  @RequirePerms('reports.view')
  async getTrialBalance(@Query() q: any) {
    return this.reportsService.getTrialBalance({
      from: q.from ?? null,
      to: q.to ?? null,
      level: q.level ? Number(q.level) : undefined,
      currency: q.currency ?? 'USD',
      invoiceType: q.invoiceType ?? 'ALL',
      mainFrom: q.mainFrom ?? null,
      mainTo: q.mainTo ?? null,
      subFrom: q.subFrom ?? null,
      subTo: q.subTo ?? null,
      mainPrefixes: q.mainPrefixes ?? '',
    });
  }

  // NEW: Standard (flat per-account, hierarchical order, parent info)
  @Get('trial-balance/standard')
  @RequirePerms('reports.view')
  async getTrialBalanceStandard(@Query() q: any) {
    return this.reportsService.getTrialBalanceStandard({
      from: q.from ?? null,
      to: q.to ?? null,
      level: q.level ? Number(q.level) : undefined,
      currency: q.currency ?? 'USD',
      invoiceType: q.invoiceType ?? 'ALL',
      mainFrom: q.mainFrom ?? null,
      mainTo: q.mainTo ?? null,
      subFrom: q.subFrom ?? null,
      subTo: q.subTo ?? null,
      mainPrefixes: q.mainPrefixes ?? '',
    });
  }

  @Get('trial-balance/currencies')
  @RequirePerms('reports.view')
  async getTrialBalanceCurrencies(@Query() q: any) {
    return this.reportsService.getTrialBalanceCurrencies({
      from: q.from ?? null,
      to: q.to ?? null,
      level: q.level ? Number(q.level) : undefined,
      currency: q.currency ?? 'USD',
      invoiceType: q.invoiceType ?? 'ALL',
      mainFrom: q.mainFrom ?? null,
      mainTo: q.mainTo ?? null,
      subFrom: q.subFrom ?? null,
      subTo: q.subTo ?? null,
      mainPrefixes: q.mainPrefixes ?? '',
    });
  }
}
