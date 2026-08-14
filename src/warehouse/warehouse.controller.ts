import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, ParseIntPipe,
} from "@nestjs/common";
import { WarehouseService } from "./warehouse.service";

@Controller("warehouses")
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get()
  findAll() {
    return this.warehouseService.findAll();
  }

  @Get("v1/stock-panel")
  getStockPanel(
    @Query("emptyOnly") emptyOnly?: string,
    @Query("warehouse") warehouse?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.warehouseService.getStockPanel({
      emptyOnly: emptyOnly === "true",
      warehouse: warehouse?.trim() || undefined,
      q: q?.trim() || undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch("v1/batches/:batchId/warehouse")
  setBatchWarehouse(
    @Param("batchId", ParseIntPipe) batchId: number,
    @Body("warehouse") warehouse: string | null,
  ) {
    return this.warehouseService.setBatchWarehouse(batchId, warehouse ?? null);
  }

  @Post()
  create(@Body("name") name: string) {
    return this.warehouseService.create(name);
  }

  @Patch(":id/set-home")
  setHome(@Param("id", ParseIntPipe) id: number) {
    return this.warehouseService.setHome(id);
  }

  @Patch(":id")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body("name") name: string,
  ) {
    return this.warehouseService.update(id, name);
  }

  @Delete(":id")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.warehouseService.remove(id);
  }

  @Post("migrate-batches")
  migrateBatches() {
    return this.warehouseService.migrateBatches();
  }
}
