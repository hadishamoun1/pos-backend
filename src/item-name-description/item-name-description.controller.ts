import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Put,
  Delete,
  UseGuards,
} from "@nestjs/common";
import { ItemNameDescriptionService } from "./item-name-description.service";
import { ItemNameDescription } from "../entities/inventory/itemNameDescription.entity";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("item-name-descriptions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItemNameDescriptionController {
  constructor(private readonly descService: ItemNameDescriptionService) {}

  // MANAGE
  @Post()
  @RequirePerms("itemsDesc.manage")
  create(@Body() data: Partial<ItemNameDescription>) {
    return this.descService.create(data);
  }

  // VIEW
  @Get()
  @RequirePerms("itemsDesc.view")
  findAll() {
    return this.descService.findAll();
  }

  @Get(":id")
  @RequirePerms("itemsDesc.view")
  findOne(@Param("id") id: number) {
    return this.descService.findOne(id);
  }

  // MANAGE
  @Put(":id")
  @RequirePerms("itemsDesc.manage")
  update(@Param("id") id: number, @Body() data: Partial<ItemNameDescription>) {
    return this.descService.update(id, data);
  }

  @Delete(":id")
  @RequirePerms("itemsDesc.manage")
  remove(@Param("id") id: number) {
    return this.descService.remove(id);
  }
}
