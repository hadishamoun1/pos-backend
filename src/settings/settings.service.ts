import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings } from '../entities/settings.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Settings)
    private readonly settingsRepository: Repository<Settings>,
  ) {}

  async getActiveYear(): Promise<string> {
    const activeSetting = await this.settingsRepository.findOne({ where: { isActive: true } });
    if (!activeSetting) throw new Error('No active year set. Please set an active year.');
    return activeSetting.year;
  }

  async setActiveYear(year: string): Promise<void> {
    // Deactivate all years first
    await this.settingsRepository.update({ isActive: true }, { isActive: false });

    // Set specified year as active
    await this.settingsRepository.update({ year }, { isActive: true });
  }

  async addYear(year: string): Promise<Settings> {
    const newYear = this.settingsRepository.create({ year, isActive: false });
    return await this.settingsRepository.save(newYear);
  }
}
