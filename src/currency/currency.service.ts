import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency } from '../entities/currency.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class CurrencyService {
  constructor(
    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  // Get all currencies
  async getAllCurrencies(): Promise<Currency[]> {
    return this.currencyRepository.find();
  }
    // Get all currency codes for dropdown
    async getCurrencyCodesForDropdown(): Promise<string[]> {
      const currencies = await this.currencyRepository.find();
      return currencies.map((currency) => currency.currencyCode);
    }

  // Get a currency by code
  async getCurrencyByCode(code: string): Promise<Currency> {
    const currency = await this.currencyRepository.findOne({
      where: { currencyCode: code },
    });
    if (!currency) {
      throw new NotFoundException('Currency not found');
    }
    return currency;
  }

  // Add a new currency
  async createCurrency(currencyData: Partial<Currency>): Promise<Currency> {
    const currency = this.currencyRepository.create(currencyData);
    return this.currencyRepository.save(currency);
  }

  // Update a currency
  async updateCurrency(
    code: string,
    currencyData: Partial<Currency>,
  ): Promise<Currency> {
    const currency = await this.getCurrencyByCode(code);
    Object.assign(currency, currencyData);
    return this.currencyRepository.save(currency);
  }

  // Delete a currency
  async deleteCurrency(code: string): Promise<void> {
    const currency = await this.getCurrencyByCode(code);
    await this.currencyRepository.remove(currency);
  }

  // Add a currency rate
  async createCurrencyRate(
    rateData: Partial<CurrencyRate>,
  ): Promise<CurrencyRate> {
    const rate = this.currencyRateRepository.create(rateData);
    return this.currencyRateRepository.save(rate);
  }

  // Get all currency rates
  async getAllCurrencyRates(): Promise<CurrencyRate[]> {
    return this.currencyRateRepository.find({ relations: ['currency'] });
  }

}
