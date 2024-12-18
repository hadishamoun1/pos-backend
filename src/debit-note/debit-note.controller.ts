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
import { DebitNoteService } from './debit-note.service';
import { DebitNote } from '../entities/Vouchers/debitNote.entity';

@Controller('debit-notes')
export class DebitNoteController {
  constructor(private readonly debitNoteService: DebitNoteService) {}

  @Post()
  async createDebitNote(@Body() data: Partial<DebitNote>): Promise<DebitNote> {
    return this.debitNoteService.createDebitNote(data);
  }

  @Get()
  async getAllDebitNotes(): Promise<DebitNote[]> {
    return this.debitNoteService.getAllDebitNotes();
  }

  @Get(':id')
  async getDebitNoteById(@Param('id') id: number): Promise<DebitNote> {
    const debitNote = await this.debitNoteService.getDebitNoteById(id);
    if (!debitNote) {
      throw new NotFoundException(`Debit Note with ID ${id} not found.`);
    }
    return debitNote;
  }

  @Put(':id')
  async updateDebitNote(
    @Param('id') id: number,
    @Body() data: Partial<DebitNote>,
  ): Promise<DebitNote> {
    return this.debitNoteService.updateDebitNote(id, data);
  }

  @Delete(':id')
  async deleteDebitNote(@Param('id') id: number): Promise<void> {
    await this.debitNoteService.deleteDebitNote(id);
  }
}
