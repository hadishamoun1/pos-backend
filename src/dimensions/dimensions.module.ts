
// dimension.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dimension } from '../entities/inventory/dimension.entity';
import { DimensionService } from './dimensions.service';
import { DimensionController } from './dimensions.controller';
import { ItemModule } from '../items/items.module'; 

@Module({
  imports: [
    TypeOrmModule.forFeature([Dimension]), 
    ItemModule, 
  ],
  providers: [DimensionService],
  controllers: [DimensionController],
})
export class DimensionModule {}
