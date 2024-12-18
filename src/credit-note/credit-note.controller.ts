import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { CreditNoteService } from './credit-note.service';
import { CreditNote } from '../entities/Vouchers/creditNote.entity';

@Controller('credit-notes')
export class CreditNoteController {
  constructor(private readonly creditNoteService: CreditNoteService) {}

  @Post()
  async createCreditNote(
    @Body() data: Partial<CreditNote>,
  ): Promise<CreditNote> {
    return this.creditNoteService.createCreditNote(data);
  }

  @Get()
  async getAllCreditNotes(): Promise<CreditNote[]> {
    return this.creditNoteService.getAllCreditNotes();
  }

  @Get(':id')
  async getCreditNoteById(@Param('id') id: number): Promise<CreditNote> {
    const creditNote = await this.creditNoteService.getCreditNoteById(id);
    if (!creditNote) {
      throw new NotFoundException(`Credit Note with ID ${id} not found.`);
    }
    return creditNote;
  }

  @Put(':id')
  async updateCreditNote(
    @Param('id') id: number,
    @Body() data: Partial<CreditNote>,
  ): Promise<CreditNote> {
    return this.creditNoteService.updateCreditNote(id, data);
  }

  @Delete(':id')
  async deleteCreditNote(@Param('id') id: number): Promise<void> {
    await this.creditNoteService.deleteCreditNote(id);
  }
}
