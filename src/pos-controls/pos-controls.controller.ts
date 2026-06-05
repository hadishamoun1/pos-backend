import { Controller, Get, Patch, Body, UseGuards } from "@nestjs/common";
import { PosControlsService } from "./pos-controls.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("pos-controls")
@UseGuards(JwtAuthGuard)
export class PosControlsController {
  constructor(private readonly service: PosControlsService) {}

  // Any authenticated user can read the controls (needed to enforce block in POS)
  @Get()
  getStatus() {
    return this.service.getStatus();
  }

  // Only users with settings.posControls permission can change the toggles
  @Patch()
  @UseGuards(PermissionsGuard)
  @RequirePerms("settings.posControls")
  update(
    @Body() body: { blockCreation?: boolean; blockViewing?: boolean }
  ) {
    return this.service.update(body);
  }
}
