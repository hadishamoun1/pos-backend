import { Controller, Post, Body, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Settings } from '../entities/settings.entity';
import { DelayService } from '../delay/delay.service';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly delayService: DelayService,
  ) {}

  // Get the active year
  @Get('active-year')
  @RequirePerms('settings.view')
  async getActiveYear(): Promise<string> {
    return await this.settingsService.getActiveYear();
  }

  // Set a specific year as active
  @Patch('set-active-year')
  @RequirePerms('settings.update')
  async setActiveYear(@Body('year') year: string): Promise<Settings> {
    return await this.settingsService.setActiveYear(year);
  }

  // Add a new year
  @Post('add-year')
  @RequirePerms('settings.update')
  async addYear(@Body('year') year: string): Promise<Settings> {
    return await this.settingsService.addYear(year);
  }

  @Get('delay')
  @RequirePerms('settings.delay')
  getDelay() {
    return { delayMs: this.delayService.getDelay() };
  }

  @Post('delay')
  @RequirePerms('settings.delay')
  setDelay(@Body('delayMs') delayMs: number) {
    this.delayService.setDelay(Number(delayMs));
    return { delayMs: this.delayService.getDelay() };
  }
}
