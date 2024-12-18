import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
  } from '@nestjs/common';
  import { DebitNoteReturnService } from './debit-note-returns.service';
  import { DebitNoteReturn } from '../entities/returnVouchers/debitNoteReturn.entity';
  
  @Controller('debit-note-returns')
  export class DebitNoteReturnController {
    constructor(
      private readonly debitNoteReturnService: DebitNoteReturnService,
    ) {}
  
    @Post()
    create(@Body() data: Partial<DebitNoteReturn>): Promise<DebitNoteReturn> {
      return this.debitNoteReturnService.createDebitNoteReturn(data);
    }
  
    @Get()
    getAll(): Promise<DebitNoteReturn[]> {
      return this.debitNoteReturnService.getAllDebitNoteReturns();
    }
  
    @Get(':id')
    getById(@Param('id') id: number): Promise<DebitNoteReturn> {
      return this.debitNoteReturnService.getDebitNoteReturnById(id);
    }
  
    @Put(':id')
    update(
      @Param('id') id: number,
      @Body() data: Partial<DebitNoteReturn>,
    ): Promise<DebitNoteReturn> {
      return this.debitNoteReturnService.updateDebitNoteReturn(id, data);
    }
  
    @Delete(':id')
    delete(@Param('id') id: number): Promise<void> {
      return this.debitNoteReturnService.deleteDebitNoteReturn(id);
    }
  }
  