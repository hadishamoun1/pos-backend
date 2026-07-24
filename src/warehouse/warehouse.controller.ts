import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, ParseIntPipe,
} from "@nestjs/common";
import { WarehouseService } from "./warehouse.service";

@Controller("warehouses")
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get()
  findAll() {
    return this.warehouseService.findAll();
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
}
