import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { CurrencyService } from "./currency.service";
import { Currency } from "../entities/currency.entity";
import { CurrencyRate } from "../entities/currencyRate.entity";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("currency")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  // VIEW
  @Get()
  @RequirePerms("currency.view")
  getAllCurrencies(): Promise<Currency[]> {
    return this.currencyService.getAllCurrencies();
  }

  @Get(":code")
  @RequirePerms("currency.view")
  getCurrencyByCode(@Param("code") code: string): Promise<Currency> {
    return this.currencyService.getCurrencyByCode(code);
  }

  // MANAGE
  @Post()
  @RequirePerms("currency.manage")
  createCurrency(@Body() currencyData: Partial<Currency>): Promise<Currency> {
    return this.currencyService.createCurrency(currencyData);
  }

  @Put(":code")
  @RequirePerms("currency.manage")
  updateCurrency(
    @Param("code") code: string,
    @Body() currencyData: Partial<Currency>
  ): Promise<Currency> {
    return this.currencyService.updateCurrency(code, currencyData);
  }

  @Delete(":code")
  @RequirePerms("currency.manage")
  deleteCurrency(@Param("code") code: string): Promise<void> {
    return this.currencyService.deleteCurrency(code);
  }

  // Currency rates (still manage)
  @Post("rate")
  @RequirePerms("currency.manage")
  createCurrencyRate(
    @Body() rateData: Partial<CurrencyRate>
  ): Promise<CurrencyRate> {
    return this.currencyService.createCurrencyRate(rateData);
  }

  @Get("rate/all")
  @RequirePerms("currency.view")
  getAllCurrencyRates(): Promise<CurrencyRate[]> {
    return this.currencyService.getAllCurrencyRates();
  }

  // Dropdown codes (view)
  @Get("v1/dropdown/currencycodes")
  @RequirePerms("currency.view")
  getCurrencyCodesForDropdown(): Promise<{ id: number; currencyCode: string }[]> {
    return this.currencyService.getCurrencyCodesForDropdown();
  }
}
