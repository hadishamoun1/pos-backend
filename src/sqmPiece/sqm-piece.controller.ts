// src/sqm-pieces/sqm-pieces.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { SqmPiecesService } from './sqm-piece.service';

@Controller('sqm-pieces')
export class SqmPiecesController {
  constructor(private readonly svc: SqmPiecesService) {}

  /**
   * List BOSTS lines with their sqm summary, grouped by (thickness + name),
   * with optional search + pagination.
   *
   * GET /sqm-pieces/lines?page=1&limit=30&q=...
   */
  @Get('lines')
  listLines(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    const pg = Math.max(1, Number(page ?? 1) || 1);
    const lim = Math.min(100, Math.max(1, Number(limit ?? 30) || 30));
    const queryText = q && q.trim() ? q.trim() : undefined;

    return this.svc.listBostsLines({
      page: pg,
      limit: lim,
      q: queryText,
    });
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

  @Get('summary')
  summaryBySqmVariant() {
    return this.svc.summaryBySqmVariant();
  }

  @Get('summary/:id')
  summaryOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.summaryForOneVariant(id);
  }

   /**
   * POS endpoint: list active SQM pieces with remaining > 0.
   * Used by SearchModal "SQM Pieces" tab.
   *
   * GET /sqm-pieces/pos-pieces?onlyRemaining=1&q=...
   */
// sqm-piece.controller.ts

@Get('pos-pieces')
async listPiecesForPos(@Query('q') q?: string) {
  return this.svc.getPosPieces({ q });
}



  /**
   * Trash some sqm from a single piece group.
   * POST /sqm-pieces/pieces/:pieceId/trash
   * body: { sqmToTrash: number, date?: string }
   */
  @Post('pieces/:pieceId/trash')
  trashFromPiece(
    @Param('pieceId', ParseIntPipe) pieceId: number,
    @Body() body: { sqmToTrash: number; date?: string },
  ) {
    return this.svc.trashFromPiece(pieceId, body);
  }

  @Post('lines/:transferItemId/trash-remaining')
  trashLineRemaining(
    @Param('transferItemId', ParseIntPipe) transferItemId: number,
    @Body() body: { sqmToTrash: number; date?: string | Date },
  ) {
    return this.svc.trashRemainingForLine(transferItemId, body);
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

  @Post('lines/:transferItemId/trash-unallocated')
  trashUnallocated(
    @Param('transferItemId', ParseIntPipe) transferItemId: number,
    @Body() body: { sqmToTrash: number; date?: string },
  ) {
    return this.svc.trashUnallocatedForLine(transferItemId, body);
  }

  @Post('lines/:transferItemId/restore-unallocated')
  async restoreUnallocated(
    @Param('transferItemId') transferItemId: string,
    @Body() body: { sqmToRestore: number; date?: string | Date },
  ) {
    const id = Number(transferItemId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('transferItemId must be a positive number.');
    }
    return this.svc.restoreUnallocatedForLine(id, body);
  }

  @Post('pieces/:pieceId/restore')
  restorePiece(
    @Param('pieceId', ParseIntPipe) pieceId: number,
    @Body() body: { sqmToRestore: number; date?: string | Date },
  ) {
    return this.svc.restoreFromPiece(pieceId, body);
  }

   @Post('groups/trash-all')
  trashGroupAll(
    @Body() body: { groupKey: string; date?: string | Date },
  ) {
    return this.svc.trashAllForGroup(body);
  }

  @Post('groups/restore-all-unallocated')
async restoreAllUnallocatedForGroup(
  @Body() body: { groupKey: string; date?: string | Date },
) {
  return this.svc.restoreAllUnallocatedForGroup(body);
}

}
