import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Put,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { Invoice } from '../entities/invoice.entity';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async createInvoice(@Body() invoiceData: Partial<Invoice>): Promise<Invoice> {
    return this.invoiceService.createInvoice(invoiceData);
  }

  @Get()
  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceService.getAllInvoices();
  }
  @Get('v1/browsing/:customerId')
  async getBrowsing(
    @Param('customerId') customerId: number,
    @Query('groupKey') groupKey?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 5,
  ) {
    return this.invoiceService.getBrowsingInvoices(
      customerId,
      limit,
      page,
      groupKey,
    );
  }


  // ✅ NEW: browsing search 
  @Get('v1/browsing/:customerId/search')
  async searchBrowsingForCustomer(
    @Param('customerId') customerId: string,
    @Query('q') q: string,
    @Query('limitPerGroup') limitPerGroup = '5',
    @Query('pagePerGroup') pagePerGroup = '1',
    @Query('groupKey') groupKey?: string,
  ) {
    const limit = Number(limitPerGroup) || 5;
    const page = Number(pagePerGroup) || 1;
    return this.invoiceService.searchBrowsingInvoices(
      Number(customerId),
      q || '',
      limit,
      page,
      groupKey,
    );
  }
@Get('v1/filtered/search')
async searchFiltered(
  @Query('q') q?: string,
  @Query('page') page = '1',
  @Query('limit') limit = '100',
) {
  const p = Number(page) || 1;
  const l = Number(limit) || 100;
  return this.invoiceService.searchFilteredInvoices(q, p, l);
}


    @Get('v1/browsing/by-item-batches/:customerId')
  async getBrowsingByItemBatchesGet(
    @Param('customerId') customerIdParam: string,
    @Query('itemBatchIds') itemBatchIdsQuery: string | string[],
    @Query('groupKey') groupKey?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const customerId = Number(customerIdParam);
    if (!customerId || Number.isNaN(customerId)) {
      throw new BadRequestException('customerId must be a number');
    }

    // Support both repeated params (?itemBatchIds=1&itemBatchIds=2) and a single comma-separated string
    let itemBatchIds: number[] = [];
    if (Array.isArray(itemBatchIdsQuery)) {
      itemBatchIds = itemBatchIdsQuery.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    } else if (typeof itemBatchIdsQuery === 'string') {
      itemBatchIds = itemBatchIdsQuery
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isFinite(n));
    }
    if (itemBatchIds.length === 0) {
      throw new BadRequestException('itemBatchIds is required (one or more IDs).');
    }

    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 5;
    if (!Number.isFinite(pageNum) || pageNum < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (!Number.isFinite(limitNum) || limitNum < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return this.invoiceService.getBrowsingInvoicesByItemBatches(
      customerId,
      itemBatchIds,
      limitNum,
      pageNum,
      groupKey,
    );
  }


  @Get('v1/:id')
  async getInvoiceById(@Param('id') id: number): Promise<Invoice> {
    return this.invoiceService.getInvoiceById(id);
  }

  @Get('filtered')
  async getFilteredInvoices(
    @Query('page',  new DefaultValuePipe(1),   ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.invoiceService.getFilteredInvoices(page, limit);
  }

  // UPDATE (full replace semantics; handles deletes/inserts/updates of items)
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ): Promise<Invoice> {
    // body uses the same shape as create; items may include existing item IDs to update
    return this.invoiceService.updateInvoice(id, body);
  }
}
