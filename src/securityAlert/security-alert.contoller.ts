import { Controller, Get, Post, Patch } from "@nestjs/common";
import { SecurityAlertService } from "./security-alert.service";

@Controller("security-alert")
export class SecurityAlertController {
  constructor(private readonly service: SecurityAlertService) {}

  // GET /security-alert — check if lockdown is active
  @Get()
  getStatus() {
    return this.service.getStatus();
  }

  // PATCH /security-alert/enable — turn lockdown ON
  @Patch("enable")
  enable() {
    return this.service.enable();
  }

  // PATCH /security-alert/disable — turn lockdown OFF
  @Patch("disable")
  disable() {
    return this.service.disable();
  }

  // PATCH /security-alert/toggle — flip current state
  @Patch("toggle")
  toggle() {
    return this.service.toggle();
  }
}