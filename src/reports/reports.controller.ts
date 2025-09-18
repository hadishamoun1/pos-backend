// src/reports/reports.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /reports/trial-balance
   * Query params (all strings as sent by your frontend):
   * - from, to (YYYY-MM-DD)
   * - level (number)
   * - currency (USD|LL|EURO|BASE)
   * - invoiceType (ALL|S|G)
   * - mainFrom, mainTo (account codes)
   * - subFrom, subTo (account codes)
   * - mainPrefixes (comma-separated prefixes, e.g. "601,705")
   */
  @Get('trial-balance')
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
      mainPrefixes: q.mainPrefixes ?? '', // e.g. "601,705"
    });
  }

  // NEW: Standard (flat per-account, hierarchical order, parent info)
  @Get('trial-balance/standard')
  async getTrialBalanceStandard(@Query() q: any) {
    return this.reportsService.getTrialBalanceStandard({
      from: q.from ?? null,
      to: q.to ?? null,
      level: q.level ? Number(q.level) : undefined, // used only to choose the starting digit length for ordering
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
