import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit-saleinvoice.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // GET /audit/invoices?from=2025-01-01&to=2025-12-31&page=1&limit=50&onlyFailed=1&deepStock=0
  @Get('invoices')
  async auditInvoices(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('onlyFailed') onlyFailed = '1',
    @Query('deepStock') deepStock = '0',
  ) {
    return this.auditService.auditInvoices({
      from,
      to,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(200, Math.max(1, Number(limit) || 50)),
      onlyFailed: String(onlyFailed) === '1',
      deepStock: String(deepStock) === '1',
    });
  }
}
