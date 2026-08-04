import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AlternativeCustomerService } from './alternative-customer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('alternative-customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AlternativeCustomerController {
  constructor(
    private readonly alternativeCustomerService: AlternativeCustomerService,
  ) {}

  @Get('search')
  @RequirePerms('invoices.update')
  async search(@Query('query') query: string) {
    return this.alternativeCustomerService.search(query);
  }

  @Get()
  @RequirePerms('invoices.update')
  async findAll() {
    return this.alternativeCustomerService.findAll();
  }

  @Post('bulk-import')
  @RequirePerms('invoices.update')
  async bulkImport(
    @Body('names')
    names: Array<{
      company: string;
      businessPhone?: string;
      address?: string;
      areaDescription?: string;
    }>,
  ) {
    return this.alternativeCustomerService.bulkImport(names || []);
  }
}
