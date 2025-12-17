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
} from '@nestjs/common';
import { JournalVoucherService } from './journal-voucher.service';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';

@Controller('journal-vouchers')
export class JournalVoucherController {
  constructor(private readonly journalVoucherService: JournalVoucherService) {}

  // Create a Journal Voucher
  @Post()
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
  async getAllJournalVouchers() {
    try {
      return await this.journalVoucherService.getAllJournalVouchers();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  
@Get('v1/list')
async getSummary(
  @Query('page') page = '1',
  @Query('limit') limit = '100',
  @Query('q') q = ''
) {
  const p = Math.max(1, parseInt(page as string, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 100));
  return this.journalVoucherService.getVoucherSummary({ page: p, limit: l, q });
}

 @Get('v1/search-by-seq')
  async searchBySeq(
    @Query('seq') seq: string,          // required
    @Query('page') page?: string,       // optional
    @Query('limit') limit?: string,     // optional
  ) {
    return this.journalVoucherService.searchBySeq({
      seq,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }


  // Get a single Journal Voucher by ID
  @Get(':id')
  async getJournalVoucherById(@Param('id') id: number) {
    try {
      return await this.journalVoucherService.getJournalVoucherById(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  // Update a Journal Voucher by ID


  // Delete a Journal Voucher by ID
  @Delete(':id')
  async deleteJournalVoucher(@Param('id') id: number) {
    try {
      return await this.journalVoucherService.deleteJournalVoucher(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }


   // Example:
  // /journal-vouchers/statements/customers/1?currency=USD
@Get('statements/customers/:customerId')
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


@Get("account-statement/ofr")
async getAccountStatementOFR(
  @Query("accountId") accountId?: string,
  @Query("customerId") customerId?: string,
  @Query("supplierId") supplierId?: string,
  @Query("type") type?: "S" | "G" | "ALL",
  @Query("from") from?: string,
  @Query("to") to?: string,
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
    type: (type as any) ?? "ALL",
    from,
    to,
  });
}

    @Get('v1/jv/search')
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
async updateJV(
  @Param('id') id: string,
  @Body() body: any
) {
  return this.journalVoucherService.updateJournalVoucherFull(Number(id), body);
}

}
