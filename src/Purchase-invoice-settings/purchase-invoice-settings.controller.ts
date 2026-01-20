import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PurchaseInvoiceSettingService } from './purchase-invoice-settings.service';
import { PurchaseInvoiceSetting } from '../entities/purchaseInvoiceSettings.entity';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('purchase-invoice-setting')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseInvoiceSettingController {
  constructor(private readonly settingService: PurchaseInvoiceSettingService) {}

  @Get()
  @RequirePerms('purchaseSettings.view')
  findAll(): Promise<PurchaseInvoiceSetting[]> {
    return this.settingService.findAll();
  }

  @Get(':id')
  @RequirePerms('purchaseSettings.view')
  findOne(@Param('id') id: string): Promise<PurchaseInvoiceSetting> {
    return this.settingService.findOne(+id);
  }

  @Post()
  @RequirePerms('purchaseSettings.update')
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
  @RequirePerms('purchaseSettings.update')
  update(
    @Param('id') id: string,
    @Body() body: Partial<PurchaseInvoiceSetting>,
  ) {
    return this.settingService.update(+id, body);
  }

  @Delete(':id')
  @RequirePerms('purchaseSettings.update')
  remove(@Param('id') id: string) {
    return this.settingService.remove(+id);
  }
}
