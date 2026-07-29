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
  UseGuards,
} from '@nestjs/common';
import { SqmPiecesService } from './sqm-piece.service';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('sqm-pieces')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SqmPiecesController {
  constructor(private readonly svc: SqmPiecesService) {}

  /**
   * List BOSTS lines with their sqm summary, grouped by (thickness + name),
   * with optional search + pagination.
   *
   * GET /sqm-pieces/lines?page=1&limit=30&q=...
   */
  @Get('lines')
  @RequirePerms('sqm.view')
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
  @RequirePerms('sqm.view')
  getLine(@Param('transferItemId', ParseIntPipe) transferItemId: number) {
    return this.svc.getPiecesForLine(transferItemId);
  }

  @Get('summary')
  @RequirePerms('sqm.view')
  summaryBySqmVariant() {
    return this.svc.summaryBySqmVariant();
  }

  @Get('summary/:id')
  @RequirePerms('sqm.view')
  summaryOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.summaryForOneVariant(id);
  }

  /**
   * POS endpoint: list active SQM pieces with remaining > 0.
   * GET /sqm-pieces/pos-pieces?q=...
   */
  @Get('pos-pieces')
  @RequirePerms('sqm.view')
  async listPiecesForPos(@Query('q') q?: string) {
    return this.svc.getPosPieces({ q });
  }

  /**
   * Debug: raw sqm_pieces rows with no filtering.
   * GET /sqm-pieces/debug-raw
   */
  @Get('debug-raw')
  async debugRaw() {
    return this.svc.debugRawPieces();
  }

  /**
   * Trash some sqm from a single piece group.
   * POST /sqm-pieces/pieces/:pieceId/trash
   */
  @Post('pieces/:pieceId/trash')
  @RequirePerms('sqm.update')
  trashFromPiece(
    @Param('pieceId', ParseIntPipe) pieceId: number,
    @Body() body: { sqmToTrash: number; date?: string },
  ) {
    return this.svc.trashFromPiece(pieceId, body);
  }

  @Post('lines/:transferItemId/trash-remaining')
  @RequirePerms('sqm.update')
  trashLineRemaining(
    @Param('transferItemId', ParseIntPipe) transferItemId: number,
    @Body() body: { sqmToTrash: number; date?: string | Date },
  ) {
    return this.svc.trashRemainingForLine(transferItemId, body);
  }

  /**
   * Save/overwrite pieces for one line.
   * POST /sqm-pieces/lines/:transferItemId
   */
  @Post('lines/:transferItemId')
  @RequirePerms('sqm.update')
  saveLine(
    @Param('transferItemId', ParseIntPipe) transferItemId: number,
    @Body()
    body: { pieces?: { length: number; width: number; count: number }[] },
  ) {
    return this.svc.savePiecesForLine(transferItemId, body);
  }

  @Post('lines/:transferItemId/trash-unallocated')
  @RequirePerms('sqm.update')
  trashUnallocated(
    @Param('transferItemId', ParseIntPipe) transferItemId: number,
    @Body() body: { sqmToTrash: number; date?: string },
  ) {
    return this.svc.trashUnallocatedForLine(transferItemId, body);
  }

  @Post('lines/:transferItemId/restore-unallocated')
  @RequirePerms('sqm.update')
  async restoreUnallocated(
    @Param('transferItemId') transferItemId: string,
    @Body() body: { sqmToRestore: number; date?: string | Date },
  ) {
    const id = Number(transferItemId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException(
        'transferItemId must be a positive number.',
      );
    }
    return this.svc.restoreUnallocatedForLine(id, body);
  }

  @Post('pieces/:pieceId/restore')
  @RequirePerms('sqm.update')
  restorePiece(
    @Param('pieceId', ParseIntPipe) pieceId: number,
    @Body() body: { sqmToRestore: number; date?: string | Date },
  ) {
    return this.svc.restoreFromPiece(pieceId, body);
  }

  @Post('groups/trash-all')
  @RequirePerms('sqm.update')
  trashGroupAll(@Body() body: { groupKey: string; date?: string | Date }) {
    return this.svc.trashAllForGroup(body);
  }

  @Post('groups/restore-all-unallocated')
  @RequirePerms('sqm.update')
  restoreAllUnallocatedForGroup(
    @Body() body: { groupKey: string; date?: string | Date },
  ) {
    return this.svc.restoreAllUnallocatedForGroup(body);
  }
}
