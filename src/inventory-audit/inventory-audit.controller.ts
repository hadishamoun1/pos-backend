import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { InventoryAuditService } from "./inventory-audit.service";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("inventory/audit")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryAuditController {
  constructor(private readonly auditService: InventoryAuditService) {}

  // VIEW audit
  @Get("ofr/all")
  @RequirePerms("inventoryAudit.view")
  async auditOfrAll(
    @Query("variantId") variantId?: string,
    @Query("tolerance") tolerance?: string
  ) {
    return this.auditService.auditOfrAll({
      variantId: variantId ? Number(variantId) : undefined,
      tolerance: tolerance == null ? undefined : Number(tolerance),
    });
  }

  // FIX audit mismatches (dangerous)
  @Post("ofr/fix")
  @RequirePerms("inventoryAudit.fix")
  fixGhostStockOfr(@Body() body: any) {
    return this.auditService.fixGhostStockOfr(body);
  }
}
