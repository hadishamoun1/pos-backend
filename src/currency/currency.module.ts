import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Currency } from '../entities/currency.entity';
import { CurrencyRate } from './currency-rate.entity';
import { CurrencyService } from './currency.service';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { CurrencyController } from './currency.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Currency, CurrencyRate])],
  providers: [CurrencyService],
  controllers: [CurrencyController],
})
export class CurrencyModule {}
