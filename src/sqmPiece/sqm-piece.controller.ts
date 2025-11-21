// src/sqm-pieces/sqm-pieces.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { SqmPiecesService } from './sqm-piece.service';

@Controller('sqm-pieces')
export class SqmPiecesController {
  constructor(private readonly svc: SqmPiecesService) {}

  /**
   * List BOSTS lines with their sqm summary.
   * GET /sqm-pieces/lines
   */
  @Get('lines')
  listLines() {
    return this.svc.listBostsLines();
  }

  /**
   * Get header + existing pieces for one line.
   * GET /sqm-pieces/lines/:transferItemId
   */
  @Get('lines/:transferItemId')
  getLine(
    @Param('transferItemId', ParseIntPipe) transferItemId: number,
  ) {
    return this.svc.getPiecesForLine(transferItemId);
  }

  /**
   * Save/overwrite pieces for one line.
   * POST /sqm-pieces/lines/:transferItemId
   *
   * Expected body:
   * {
   *   "pieces": [
   *     { "length": 80, "width": 150, "count": 3 },
   *     { "length": 50, "width": 100, "count": 2 }
   *   ]
   * }
   */
  @Post('lines/:transferItemId')
  saveLine(
    @Param('transferItemId', ParseIntPipe) transferItemId: number,
    @Body()
    body: { pieces?: { length: number; width: number; count: number }[] },
  ) {
    return this.svc.savePiecesForLine(transferItemId, body);
  }
}
