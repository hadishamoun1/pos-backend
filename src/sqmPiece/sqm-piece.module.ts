// src/sqm-pieces/sqm-pieces.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SqmPiece } from '../entities/inventory/SqmPiece.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { Transfer } from '../entities/inventory/transfer.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { SqmPiecesService } from './sqm-piece.service';
import { SqmPiecesController } from './sqm-piece.controller';
import { InventoryTransaction } from 'src/entities/inventory/inventoryTransactions.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SqmPiece,
      TransferItem,
      Transfer,
      ItemBatch,
      ItemVariant,
      Thickness,
      InventoryTransaction
    ]),
  ],
  providers: [SqmPiecesService],
  controllers: [SqmPiecesController],
})
export class SqmPiecesModule {}
