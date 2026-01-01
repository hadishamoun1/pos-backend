// src/csv-import/csv-import.controller.ts
import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { CsvImportService } from './HistoryPrices.service';

@Controller('csv-imports')
export class CsvImportController {
  constructor(private readonly csvImportService: CsvImportService) {}

  /**
   * GET /csv-imports/customers
   * Get unique customers list with pagination
   * Query params:
   *   - page: page number (default: 1)
   *   - limit: items per page (default: 50, max: 200)
   *   - search: search term for customer name (optional)
   */
  @Get('customers')
  async getUniqueCustomers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('search') search?: string,
  ) {
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('Invalid page number');
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
      throw new BadRequestException('Limit must be between 1 and 200');
    }

    return await this.csvImportService.getUniqueCustomers(
      pageNum,
      limitNum,
      search,
    );
  }

  /**
   * GET /csv-imports/customers/:name
   * Get specific customer details by name
   */
  @Get('customers/:name')
  async getCustomerByName(@Param('name') customerName: string) {
    return await this.csvImportService.getCustomerByName(
      decodeURIComponent(customerName),
    );
  }

  /**
   * GET /csv-imports/customers/:name/history
   * Get customer's purchase history with pagination
   */
  @Get('customers/:name/history')
  async getCustomerHistory(
    @Param('name') customerName: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return await this.csvImportService.getCustomerHistory(
      decodeURIComponent(customerName),
      parseInt(page),
      parseInt(limit),
    );
  }

  /**
   * GET /csv-imports/customers/:name/top-items
   * Get customer's most purchased items
   */
  @Get('customers/:name/top-items')
  async getCustomerTopItems(
    @Param('name') customerName: string,
    @Query('limit') limit: string = '10',
  ) {
    return await this.csvImportService.getCustomerTopItems(
      decodeURIComponent(customerName),
      parseInt(limit),
    );
  }

  /**
   * GET /csv-imports/customers/:name/timeline
   * Get customer's purchase timeline (monthly)
   */
  @Get('customers/:name/timeline')
  async getCustomerTimeline(@Param('name') customerName: string) {
    return await this.csvImportService.getCustomerTimeline(
      decodeURIComponent(customerName),
    );
  }

  @Get('search')
async searchHistory(
  @Query('itemName') itemName?: string,
  @Query('length') length?: string,
  @Query('width') width?: string,
  @Query('page') page: string = '1',
  @Query('limit') limit: string = '50',
) {
  return await this.csvImportService.searchHistory({
    itemName,
    length: length ? parseFloat(length) : undefined,
    width: width ? parseFloat(width) : undefined,
    page: parseInt(page),
    limit: parseInt(limit),
  });
}
}