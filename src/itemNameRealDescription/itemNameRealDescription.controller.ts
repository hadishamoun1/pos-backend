import {
  BadRequestException,
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { RealDescriptionsService } from "./itemNameRealDescription.service";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("real-descriptions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RealDescriptionsController {
  constructor(private readonly svc: RealDescriptionsService) {}

  // VIEW
  @Get()
  @RequirePerms("realDesc.view")
  async list(@Query() query: any) {
    const q = typeof query.q === "string" ? query.q : undefined;

    let withCounts: boolean | undefined;
    if (query.withCounts !== undefined) {
      const s = String(query.withCounts).toLowerCase().trim();
      withCounts = s === "1" || s === "true" || s === "yes";
    }

    return this.svc.listSorted({ q, withCounts: withCounts ?? false });
  }

  // MANAGE (reorder is an edit)
  @Put("reorder")
  @RequirePerms("realDesc.manage")
  async reorder(@Body() body: any) {
    if (!body || !Array.isArray(body.order) || body.order.length === 0) {
      throw new BadRequestException(
        "Body must be { order: number[] } with at least one id."
      );
    }
    const order = body.order.map((x: any) => Number(x));
    const invalid = order.filter((n: number) => !Number.isInteger(n) || n < 1);
    if (invalid.length) {
      throw new BadRequestException(
        `Order must be an array of positive integer IDs. Invalid: [${invalid.join(
          ", "
        )}]`
      );
    }
    await this.svc.reorder(order);
    return { ok: true };
  }

  // MANAGE
  @Post()
  @RequirePerms("realDesc.manage")
  async create(@Body() body: any) {
    return this.svc.create(body);
  }

  // VIEW one
  @Get(":id")
  @RequirePerms("realDesc.view")
  async getOne(@Param("id") idParam: string) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException("id must be a positive integer.");
    }
    return this.svc.getOne(id);
  }

  // MANAGE
  @Put(":id")
  @RequirePerms("realDesc.manage")
  async update(@Param("id") idParam: string, @Body() body: any) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException("id must be a positive integer.");
    }
    return this.svc.update(id, body);
  }

  // MANAGE
  @Delete(":id")
  @RequirePerms("realDesc.manage")
  async remove(@Param("id") idParam: string) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException("id must be a positive integer.");
    }
    return this.svc.remove(id);
  }
}
