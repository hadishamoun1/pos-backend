import { Controller, Post, Body, Get, Patch } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Settings } from '../entities/settings.entity';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('active-year')
  async getActiveYear(): Promise<string> {
    return await this.settingsService.getActiveYear();
  }

  @Patch('set-active-year')
  async setActiveYear(@Body('year') year: string): Promise<void> {
    return await this.settingsService.setActiveYear(year);
  }

  @Post('add-year')
  async addYear(@Body('year') year: string): Promise<Settings> {
    return await this.settingsService.addYear(year);
  }
}
