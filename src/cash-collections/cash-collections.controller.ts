// src/cash-collections/cash-collections.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  ParseIntPipe,
  ForbiddenException,
} from "@nestjs/common";
import { CashCollectionsService } from "./cash-collections.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("cash-collections")
@UseGuards(JwtAuthGuard)
export class CashCollectionsController {
  constructor(private readonly service: CashCollectionsService) {}

  // employees create entries
  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const employeeId = req.user.userId; // ✅ IMPORTANT
    return this.service.create(body, employeeId);
  }

  /**
   * ✅ NEW:
   * Mark cash collections as linked to a receivable entry (prevents duplicates).
   * Body: { ids: number[], receivableEntryId: number }
   */
  @Post("v1/mark-receivable")
  async markReceivable(@Body() body: any, @Req() req: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const receivableEntryId = Number(body?.receivableEntryId);

    const perms: string[] = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const canViewAny = req.user.role === "ADMIN" || perms.includes("cashFlow.viewAny");

    return this.service.markReceivableLink({
      ids,
      receivableEntryId,
      employeeId: req.user.userId,
      canViewAny,
    });
  }

  /**
   * Listing:
   * - normal employee: can only see his rows (forced)
   * - admin: can see all + filter by employeeId
   */
  @Get()
  async list(@Query() query: any, @Req() req: any) {
    const perms: string[] = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const canViewAny = req.user.role === "ADMIN" || perms.includes("cashFlow.viewAny");

    if (!canViewAny) {
      query.employeeId = req.user.userId;
    }

    return this.service.list(query);
  }

  // optional: only admin can delete (recommended)
  @Delete(":id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms("cashFlow.delete") // or create new perm like "cashCollections.manage"
  async remove(@Param("id", ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Get(":id")
  async getOne(@Param("id", ParseIntPipe) id: number, @Req() req: any) {
    const row = await this.service.getOne(id);

    const perms: string[] = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const canViewAny = req.user.role === "ADMIN" || perms.includes("cashFlow.viewAny");

    if (!canViewAny && row.employeeId !== req.user.userId) {
      throw new ForbiddenException("Not allowed");
    }

    return row;
  }
}
