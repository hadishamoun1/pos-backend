// src/inventory-count/inventory-count.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InventoryCountService } from "./count.service";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";
import { CountType } from '../entities/inventory/count.entity';
import { use } from "passport";

@Controller("inventory-count")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryCountController {
  constructor(private readonly svc: InventoryCountService) {}

  // CREATE counts
  @Post()
  @RequirePerms("inventoryCount.create")
  create(@Body() createData: any | any[]) {
    return this.svc.create(createData);
  }

  // VIEW counts
  @Get()
  @RequirePerms("inventoryCount.view")
  findAll() {
    return this.svc.findAll();
  }

  @Get("v1/filtered")
  @RequirePerms("inventoryCount.view")
  getFilteredCounts() {
    return this.svc.getFilteredCounts();
  }

  @Get("v1/search")
  @RequirePerms("inventoryCount.view")
  async search(
    @Query("q") q?: string,
    @Query("mode") mode: "name" | "real" = "name",
    @Query("itemName") itemName?: string,
    @Query("type") type?: "box" | "sheet" | "sqm" | "unit",
    @Query("thickness") thickness?: string,
    @Query("length") length?: string,
    @Query("width") width?: string,
    @Query("sheetsPerBox") sheetsPerBox?: string,
    @Query("origin") origin?: string,
    @Query("page") page = "1",
    @Query("limit") limit = "50"
  ) {
    return this.svc.searchVariants({
      q,
      mode,
      itemName,
      type,
      thickness: thickness != null ? Number(thickness) : undefined,
      length: length != null ? Number(length) : undefined,
      width: width != null ? Number(width) : undefined,
      sheetsPerBox: sheetsPerBox != null ? Number(sheetsPerBox) : undefined,
      origin,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get("filtered-with-balance")
  @RequirePerms("inventoryCount.view")
  async getFilteredCountsWithBalance() {
    return this.svc.getFilteredCountsWithBatchBalance();
  }


   @Get('audit/count-transactions')
  async auditCountTransactions(
    @Query('asOf') asOf?: string,
    @Query('type') type?: CountType,
    @Query('limit') limit?: string,
  ) {
    return this.svc.auditCountTransactions({
      asOf,
      type,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // OPENING count creation
  @Post("v1/opening")
  @RequirePerms("inventoryCount.create")
  @HttpCode(HttpStatus.CREATED)
  async createOpening(@Body() body: any) {
    const result = await this.svc.createSingleopening(body);
    return { message: "Opening count created successfully", data: result };
  }

  // Rebuild opening counts (dangerous)
  @Post("opening/rebuild")
  @RequirePerms("inventoryCount.rebuild")
  rebuildOpening(@Body() body: { keepDate: string; deleteDate: string }) {
    return this.svc.rebuildOpeningCountsKeepDate(body);
  }


   @Post('opening-snapshot-g')
  async createOpeningSnapshotG(@Body() body: any) {
    const asOf = body?.asOf || '2026-01-01';

    return this.svc.createOpeningSnapshotG({
      asOf,
      deleteExisting: true,
      skipZeroRows: true,
    });
  }

  // Inventory check creation
@Post("v1/inventory-check")
@RequirePerms("inventoryCount.create")
async createInventoryCheck(
  @Body()
  body: {
    itemBatchId: number;
    itemType: "box" | "sheet" | "sqm";
    length: number;
    width: number;
    sheetsPerBox: number;
    records: {
      count: number;
      receivedDate: string | null;
      condition: string | null;
      status: "adj+" | "adj-" | "breakage";
      targetBatchId?: number | null; // ✅ optional (only for adj+)
    }[];
  }
): Promise<void> {
  const { itemBatchId, itemType, length, width, sheetsPerBox, records } = body;

  await this.svc.createInventoryCheck(
    itemBatchId,
    itemType,
    length,
    width,
    sheetsPerBox,
    records
  );
}


  // UPDATE count
  @Patch(":id")
  @RequirePerms("inventoryCount.update")
  update(@Param("id") id: string, @Body() updateData: any) {
    return this.svc.update(+id, updateData);
  }

  // GET one
  @Get(":id")
  @RequirePerms("inventoryCount.view")
  findOne(@Param("id") id: string) {
    return this.svc.findOne(+id);
  }

  // Strict delete/recompute (dangerous)
  @Post("v1/delete-counts-strict")
  @RequirePerms("inventoryCount.delete")
  deleteCountsStrict(@Body() body: { ids: number[] }) {
    return this.svc.deleteCountsStrictRecomputeFromCounts(body);
  }
}
