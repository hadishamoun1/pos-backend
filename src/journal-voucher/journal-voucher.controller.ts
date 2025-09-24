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
  @Put(':id')
  async updateJournalVoucher(
    @Param('id') id: number,
    @Body() data: Partial<JournalVoucher>,
  ) {
    try {
      return await this.journalVoucherService.updateJournalVoucher(id, data);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  // Delete a Journal Voucher by ID
  @Delete(':id')
  async deleteJournalVoucher(@Param('id') id: number) {
    try {
      return await this.journalVoucherService.deleteJournalVoucher(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get('v1/list')
  async getVoucherSummary() {
    return this.journalVoucherService.getVoucherSummary();
  }


   // Example:
  // /journal-vouchers/statements/customers/1?currency=USD
  // /journal-vouchers/statements/customers/1?currency=LL&from=2025-01-01&to=2025-12-31
  // /journal-vouchers/statements/customers/1?currency=EURO
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


 @Get('account-statement/ofr')
  async getAccountStatementOFR(
    @Query('accountId', ParseIntPipe) accountId: number,
    @Query('type') type?: 'S' | 'G' | 'ALL',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.journalVoucherService.getAccountStatementOFR({
      accountId,
      type: (type as any) ?? 'ALL',
      from,
      to,
    });
  }

}
