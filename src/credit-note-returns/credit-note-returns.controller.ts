import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { CreditNoteReturnService } from './credit-note-returns.service';
import { CreditNoteReturn } from '../entities/returnVouchers/creditNoteReturn.entity';

@Controller('credit-note-returns')
export class CreditNoteReturnController {
  constructor(
    private readonly creditNoteReturnService: CreditNoteReturnService,
  ) {}

  @Post()
  create(@Body() data: Partial<CreditNoteReturn>): Promise<CreditNoteReturn> {
    return this.creditNoteReturnService.createCreditNoteReturn(data);
  }

  @Get()
  getAll(): Promise<CreditNoteReturn[]> {
    return this.creditNoteReturnService.getAllCreditNoteReturns();
  }

  @Get(':id')
  getById(@Param('id') id: number): Promise<CreditNoteReturn> {
    return this.creditNoteReturnService.getCreditNoteReturnById(id);
  }

  @Put(':id')
  update(
    @Param('id') id: number,
    @Body() data: Partial<CreditNoteReturn>,
  ): Promise<CreditNoteReturn> {
    return this.creditNoteReturnService.updateCreditNoteReturn(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: number): Promise<void> {
    return this.creditNoteReturnService.deleteCreditNoteReturn(id);
  }
}
