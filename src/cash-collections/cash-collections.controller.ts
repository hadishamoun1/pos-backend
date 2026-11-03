// src/cash-collections/cash-collections.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  ParseIntPipe,
  ForbiddenException,
} from "@nestjs/common";
import { CashCollectionsService } from "./cash-collections.service";
import { CashCollectionsGateway } from "./cash-collections.gateway";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("cash-collections")
@UseGuards(JwtAuthGuard)
export class CashCollectionsController {
  constructor(
    private readonly service: CashCollectionsService,
    private readonly gateway: CashCollectionsGateway,
  ) {}

  // employees create entries
  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const employeeId = req.user.userId; // ✅ IMPORTANT
    const row = await this.service.create(body, employeeId);
    this.gateway.emitChanged("created", [row.id]);
    return row;
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

    const result = await this.service.markReceivableLink({
      ids,
      receivableEntryId,
      employeeId: req.user.userId,
      canViewAny,
    });
    this.gateway.emitChanged("linked", ids.map(Number));
    return result;
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

  // ── Approval request routes (literal paths — must come before :id wildcard) ──

  /** Any employee can submit a duplicate-override request */
  @Post("approval-requests")
  async createApprovalRequest(@Body() body: any, @Req() req: any) {
    const result = await this.service.createApprovalRequest(body, req.user.userId);
    this.gateway.emitChanged("approval-requested");
    return result;
  }

  /** Admin/manager lists pending (or all) approval requests */
  @Get("approval-requests")
  async listApprovalRequests(@Query("status") status: string, @Req() req: any) {
    const perms: string[] = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const canViewAny = req.user.role === "ADMIN" || perms.includes("cashFlow.viewAny");
    if (!canViewAny) throw new ForbiddenException("Admin access required");
    return this.service.listApprovalRequests(status);
  }

  @Post("approval-requests/:id/approve")
  async approveRequest(@Param("id", ParseIntPipe) id: number, @Req() req: any) {
    const perms: string[] = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const canViewAny = req.user.role === "ADMIN" || perms.includes("cashFlow.viewAny");
    if (!canViewAny) throw new ForbiddenException("Admin access required");
    const result = await this.service.approveRequest(id, req.user.userId);
    this.gateway.emitChanged("approval-approved");
    return result;
  }

  @Post("approval-requests/:id/reject")
  async rejectRequest(@Param("id", ParseIntPipe) id: number, @Req() req: any) {
    const perms: string[] = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const canViewAny = req.user.role === "ADMIN" || perms.includes("cashFlow.viewAny");
    if (!canViewAny) throw new ForbiddenException("Admin access required");
    const result = await this.service.rejectRequest(id, req.user.userId);
    this.gateway.emitChanged("approval-rejected");
    return result;
  }

  // ── Wildcard :id routes (must come after all literal paths) ──────

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

  // Only allowed while the collection isn't created as a receivable yet.
  @Patch(":id")
  async update(@Param("id", ParseIntPipe) id: number, @Body() body: any) {
    const row = await this.service.update(id, body);
    this.gateway.emitChanged("updated", [id]);
    return row;
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms("cashFlow.delete")
  async remove(@Param("id", ParseIntPipe) id: number) {
    const result = await this.service.remove(id);
    this.gateway.emitChanged("deleted", [id]);
    return result;
  }
}
