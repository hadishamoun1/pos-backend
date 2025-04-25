import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
} from '@nestjs/common';
import { PurchaseInvoiceSettingService } from './purchase-invoice-settings.service';
import { PurchaseInvoiceSetting } from '../entities/purchaseInvoiceSettings';

@Controller('purchase-invoice-setting')
export class PurchaseInvoiceSettingController {
  constructor(private readonly settingService: PurchaseInvoiceSettingService) {}

  @Get()
  findAll(): Promise<PurchaseInvoiceSetting[]> {
    return this.settingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<PurchaseInvoiceSetting> {
    return this.settingService.findOne(+id);
  }

  @Post()
  create(
    @Body()
    body: Partial<PurchaseInvoiceSetting> | Partial<PurchaseInvoiceSetting>[],
  ) {
    if (Array.isArray(body)) {
      return this.settingService.createMany(body);
    } else {
      return this.settingService.create(body);
    }
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() body: Partial<PurchaseInvoiceSetting>,
  ) {
    return this.settingService.update(+id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.settingService.remove(+id);
  }
}
