// dimension.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dimension } from '../entities/inventory/dimension.entity';
import { DimensionService } from './dimensions.service';
import { DimensionController } from './dimensions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Dimension])],
  providers: [DimensionService],
  controllers: [DimensionController],
  exports: [DimensionService],
})
export class DimensionModule {}
