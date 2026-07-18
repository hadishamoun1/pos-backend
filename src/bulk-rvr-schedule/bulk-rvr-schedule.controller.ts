import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { BulkRvrScheduleService } from './bulk-rvr-schedule.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('bulk-rvr-schedule')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BulkRvrScheduleController {
  constructor(private readonly service: BulkRvrScheduleService) {}

  @Get()
  @RequirePerms('recievables.rvr')
  getConfig() {
    return this.service.getConfig();
  }

  @Patch()
  @RequirePerms('recievables.rvr')
  updateConfig(@Body() body: any) {
    return this.service.updateConfig(body);
  }

  @Post('run')
  @RequirePerms('recievables.rvr')
  runNow() {
    return this.service.runNow();
  }

  @Get('item-pool')
  @RequirePerms('rvrRandomizer.view')
  getItemPool() {
    return this.service.getItemPool();
  }

  @Patch('item-pool')
  @RequirePerms('rvrRandomizer.view')
  saveItemPool(@Body() body: { pool: any[] }) {
    return this.service.saveItemPool(body.pool ?? []);
  }
}
