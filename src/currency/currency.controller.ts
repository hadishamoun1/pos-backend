import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { CurrencyService } from './currency.service';
import { Currency } from '../entities/currency.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Controller('currency')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  // Get all currencies
  @Get()
  getAllCurrencies(): Promise<Currency[]> {
    return this.currencyService.getAllCurrencies();
  }

  // Get a specific currency by code
  @Get(':code')
  getCurrencyByCode(@Param('code') code: string): Promise<Currency> {
    return this.currencyService.getCurrencyByCode(code);
  }

  // Add a new currency
  @Post()
  createCurrency(@Body() currencyData: Partial<Currency>): Promise<Currency> {
    return this.currencyService.createCurrency(currencyData);
  }

  // Update a currency
  @Put(':code')
  updateCurrency(
    @Param('code') code: string,
    @Body() currencyData: Partial<Currency>,
  ): Promise<Currency> {
    return this.currencyService.updateCurrency(code, currencyData);
  }

  // Delete a currency
  @Delete(':code')
  deleteCurrency(@Param('code') code: string): Promise<void> {
    return this.currencyService.deleteCurrency(code);
  }

  // Add a currency rate
  @Post('rate')
  createCurrencyRate(
    @Body() rateData: Partial<CurrencyRate>,
  ): Promise<CurrencyRate> {
    return this.currencyService.createCurrencyRate(rateData);
  }

  // Get all currency rates
  @Get('rate/all')
  getAllCurrencyRates(): Promise<CurrencyRate[]> {
    return this.currencyService.getAllCurrencyRates();
  }

  // Get all currency codes for dropdown
  @Get('v1/dropdown/currencycodes')
  getCurrencyCodesForDropdown(): Promise<
    { id: number; currencyCode: string }[]
  > {
    return this.currencyService.getCurrencyCodesForDropdown();
  }
}
