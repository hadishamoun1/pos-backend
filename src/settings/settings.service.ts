import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings } from '../entities/settings.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,
  ) {}

  // Get the currently active year
  async getActiveYear(): Promise<string> {
    const activeSetting = await this.settingsRepo.findOne({
      where: { isActive: true },
    });
    if (!activeSetting) {
      throw new Error('No active year set.');
    }
    return activeSetting.year;
  }

  // Set a specific year as active
  async setActiveYear(year: string): Promise<Settings> {
    // Deactivate all other years
    await this.settingsRepo.update({}, { isActive: false });

    // Activate the specified year
    const setting = await this.settingsRepo.findOne({ where: { year } });
    if (setting) {
      setting.isActive = true;
      return this.settingsRepo.save(setting);
    }

    throw new Error(`Year ${year} not found.`);
  }

  // Add a new year to the settings
  async addYear(year: string): Promise<Settings> {
    const existingSetting = await this.settingsRepo.findOne({
      where: { year },
    });
    if (existingSetting) {
      throw new Error(`Year ${year} already exists.`);
    }

    const newSetting = this.settingsRepo.create({ year, isActive: false });
    return this.settingsRepo.save(newSetting);
  }
}
