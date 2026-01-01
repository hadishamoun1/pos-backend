// src/csv-import/csv-import.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CsvImport } from '../entities/historyPrice.entity';
import { CsvImportController } from './HistoryPrices.controller';
import { CsvImportService } from './HistoryPrices.service';

@Module({
  imports: [TypeOrmModule.forFeature([CsvImport])],
  controllers: [CsvImportController],
  providers: [CsvImportService],
  exports: [CsvImportService],
})
export class CsvImportModule {}