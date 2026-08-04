import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  BadRequestException,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JournalVoucherService } from './journal-voucher.service';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('journal-vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JournalVoucherController {
  constructor(private readonly journalVoucherService: JournalVoucherService) {}

  // Create a Journal Voucher
  @Post()
  @RequirePerms('journal.create')
  async createJournalVoucher(
    @Body()
    body: {
      date: Date;
      jvType: string;
      accountId: number; // Explicit accountId
      details: {
        accountId: number;
        check?: string | null;
        checkDate?: Date | null;
        bankName?: string | null;
        description?: string | null;
        debit: string;
        debitUSD: string;
        debitLL: string;
        credit: string;
        creditUSD: string;
        creditLL: string;
        currency: string;
        exchangeRateEURtoUSD: string;
        exchangeRate: string;
        docNbr?: string | null;
      }[];
    },
  ): Promise<JournalVoucher> {
    try {
      console.log('Received Payload:', body);
      return await this.journalVoucherService.createJournalVoucher(body);
    } catch (error) {
      console.error('Error creating Journal Voucher:', error);
      throw new HttpException(
        {
          message: error.message || 'Failed to create journal voucher',
          error: error.name || 'UnknownError',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  // Get all Journal Vouchers
  @Get()
  @RequirePerms('journal.view')
  async getAllJournalVouchers() {
    try {
      return await this.journalVoucherService.getAllJournalVouchers();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('v1/list')
  @RequirePerms('journal.view')
  async getSummary(
    @Query('page') page = '1',
    @Query('limit') limit = '100',
    @Query('q') q = '',
  ) {
    const p = Math.max(1, parseInt(page as string, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 100));
    return this.journalVoucherService.getVoucherSummary({ page: p, limit: l, q });
  }

// journal-voucher.controller.ts
@Get("v1/search-by-seq")
searchBySeq(@Query() query: any) {
  return this.journalVoucherService.searchBySeq({
    seq: query.seq,
    q: query.q ?? query.query ?? "",   // ✅ accept both
    page: query.page,
    limit: query.limit,
    type: query.type,
  });
}



  /**
   * GET /journal-vouchers/reports/customer-activity
   * ?from=2026-01-01&to=2026-03-11&type=S&minInvoices=0&minPaid=0
   */
  @Get('reports/customer-activity')
  @RequirePerms('journal.view')
  async getCustomerActivity(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: 'S' | 'G' | 'ALL',
    @Query('minInvoices') minInvoices?: string,
    @Query('minPaid') minPaid?: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('Both from and to query params are required.');
    }
    return this.journalVoucherService.getCustomerActivityReport({
      from,
      to,
      type: (type as any) ?? 'ALL',
      minInvoices: minInvoices ? parseFloat(minInvoices) : undefined,
      minPaid:     minPaid     ? parseFloat(minPaid)     : undefined,
    });
  }

  // Get a single Journal Voucher by ID
  @Get(':id')
  @RequirePerms('journal.view')
  async getJournalVoucherById(@Param('id') id: number) {
    try {
      return await this.journalVoucherService.getJournalVoucherById(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  // Delete a Journal Voucher by ID
  @Delete(':id')
  @RequirePerms('journal.delete')
  async deleteJournalVoucher(@Param('id') id: number) {
    try {
      return await this.journalVoucherService.deleteJournalVoucher(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get('statements/net/:customerId')
  @RequirePerms('journal.view')
  async getNetPositionStatement(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('type') type?: 'S' | 'G' | 'ALL',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.journalVoucherService.getNetPositionStatement({
      customerId,
      type: (type as any) || 'ALL',
      from,
      to,
    });
  }

  // Example:
  // /journal-vouchers/statements/customers/1?currency=USD
  @Get('statements/customers/:customerId')
  @RequirePerms('journal.view')
  async getCustomerStmt(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('type') type?: 'S' | 'G' | 'ALL',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.journalVoucherService.getCustomerStatementOFR({
      customerId,
      type: (type as any) || 'ALL',
      from,
      to,
    });
  }

  // Statement scoped to a specific alternative customer (not the real customer's account)
  @Get('statements/alternative-customers/:alternativeCustomerId')
  @RequirePerms('journal.view')
  async getAlternativeCustomerStmt(
    @Param('alternativeCustomerId', ParseIntPipe) alternativeCustomerId: number,
    @Query('type') type?: 'S' | 'G' | 'ALL',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.journalVoucherService.getAlternativeCustomerStatementOFR({
      alternativeCustomerId,
      type: (type as any) || 'ALL',
      from,
      to,
    });
  }

  @Get('reports/net-positions')
  @RequirePerms('journal.view')
  async getAllCustomersNetPosition(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: 'S' | 'G' | 'ALL',
  ) {
    return this.journalVoucherService.getAllCustomersNetPosition({
      from,
      to,
      type: (type as any) || 'ALL',
    });
  }

  // GET /journal-vouchers/reports/customer-balances?to=2025-12-30&type=S
@Get('reports/customer-balances')
@RequirePerms('journal.view')
async getCustomerBalances(
  @Query('to') to?: string, // 'YYYY-MM-DD' - defaults to today
  @Query('type') type?: 'S' | 'G' | 'ALL', // defaults to ALL
  @Query('minBalance') minBalance?: string, // minimum balance filter (e.g., '5')
) {
  return this.journalVoucherService.getCustomerBalancesReport({
    to,
    type: (type as any) || 'ALL',
    minBalance: minBalance ? parseFloat(minBalance) : undefined,
  });
}

  @Get('account-statement/ofr')
  @RequirePerms('journal.view')
  async getAccountStatementOFR(
    @Query('accountId') accountId?: string,
    @Query('customerId') customerId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('type') type?: 'S' | 'G' | 'ALL',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('currency') currency?: 'USD' | 'LL',
  ) {
    const toOptInt = (v?: string) => {
      if (v == null) return undefined;
      const s = String(v).trim();
      if (!s) return undefined;
      const n = Number(s);
      if (!Number.isFinite(n)) throw new BadRequestException(`Invalid id: ${v}`);
      return n;
    };

    return this.journalVoucherService.getAccountStatementOFR({
      accountId: toOptInt(accountId),
      customerId: toOptInt(customerId),
      supplierId: toOptInt(supplierId),
      type: (type as any) ?? 'ALL',
      from,
      to,
      currency: currency ?? 'USD',
    });
  }

  @Get('v1/jv/search')
  @RequirePerms('journal.view')
  async searchByCustomerOrJv(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.journalVoucherService.searchByCustomerOrJv({
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Put(':id')
  @RequirePerms('journal.update')
  async updateJV(@Param('id') id: string, @Body() body: any) {
    return this.journalVoucherService.updateJournalVoucherFull(Number(id), body);
  }
}
