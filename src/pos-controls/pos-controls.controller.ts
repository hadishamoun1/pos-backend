import { Controller, Get, Patch, Body, UseGuards } from "@nestjs/common";
import { PosControlsService } from "./pos-controls.service";
import { PosControlsGateway } from "./pos-controls.gateway";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("pos-controls")
@UseGuards(JwtAuthGuard)
export class PosControlsController {
  constructor(
    private readonly service: PosControlsService,
    private readonly gateway: PosControlsGateway,
  ) {}

  // Any authenticated user can read the controls (needed to enforce block in POS)
  @Get()
  getStatus() {
    return this.service.getStatus();
  }

  // Only users with settings.posControls permission can change the toggles
  @Patch()
  @UseGuards(PermissionsGuard)
  @RequirePerms("settings.posControls")
  async update(
    @Body() body: { blockCreation?: boolean; blockViewing?: boolean; lockOldEdits?: boolean }
  ) {
    const controls = await this.service.update(body);
    // Push the new switches to every open page right away.
    this.gateway.emitChanged(controls);
    return controls;
  }
}
