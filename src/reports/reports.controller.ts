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


  @Get('profitability')
@RequirePerms('reports.view')
async getProfitability(@Query() q: any) {
  // ✅ Default: current year (2026-01-01 to today)
  const now = new Date();
  const currentYear = now.getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const today = now.toISOString().slice(0, 10);

  return this.reportsService.getProfitability({
    from: q.from ?? yearStart,
    to: q.to ?? today,
    customerId: q.customerId ? Number(q.customerId) : undefined,
    itemVariantId: q.itemVariantId ? Number(q.itemVariantId) : undefined,
    invoiceType: q.invoiceType ?? 'ALL',
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

  @Get('top-customers')
  @RequirePerms('reports.view')
  async getTopCustomers(@Query() q: any) {
    return this.reportsService.getTopCustomers({
      from:        q.from        ?? null,
      to:          q.to          ?? null,
      limit:       q.limit       ? Number(q.limit) : null,
      invoiceType: q.invoiceType ?? 'BOTH',
    });
  }

  @Get('profitability/monthly')
@RequirePerms('reports.view')
async getProfitabilityByMonth(@Query() q: any) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const today = now.toISOString().slice(0, 10);

  return this.reportsService.getProfitabilityByMonth({
    from: q.from ?? yearStart,
    to:   q.to   ?? today,
    customerId:  q.customerId  ? Number(q.customerId)  : undefined,
    invoiceType: q.invoiceType ?? 'ALL',
  });
}
}
