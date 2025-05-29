// src/transfers/transfers.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { Settings } from '../entities/settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Transfer, TransferItem, Settings])],
  providers: [TransfersService],
  controllers: [TransfersController],
})
export class TransfersModule {}
