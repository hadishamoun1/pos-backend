import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Settings } from '../entities/settings.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { DelayModule } from '../delay/delay.module';

@Module({
  imports: [TypeOrmModule.forFeature([Settings]), DelayModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService, TypeOrmModule],
})
export class SettingsModule {}
