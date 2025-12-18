import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { InventoryAuditService } from './inventory-audit.service';

@Controller('inventory/audit')
export class InventoryAuditController {
  constructor(private readonly auditService: InventoryAuditService) {}

  /**
   * GET /inventory/audit/ofr
   * Query:
   *  - variantId=123 (optional)
   *  - onlyMismatch=1|0 (default 1)
   *  - tolerance=0.01 (default 0.01)
   *  - limit=200 (max 2000)
   *  - offset=0
   */
@Get("ofr/all")
async auditOfrAll(
  @Query("variantId") variantId?: string,
  @Query("tolerance") tolerance?: string,
) {
  return this.auditService.auditOfrAll({
    variantId: variantId ? Number(variantId) : undefined,
    tolerance: tolerance == null ? undefined : Number(tolerance),
  });
}


  @Post('ofr/fix')
  fixGhostStockOfr(@Body() body: any) {
    return this.auditService.fixGhostStockOfr(body);
  }

}
