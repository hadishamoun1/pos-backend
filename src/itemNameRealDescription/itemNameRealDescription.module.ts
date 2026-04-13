import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealDescriptionsController } from './itemNameRealDescription.controller';
import { RealDescriptionsService } from './itemNameRealDescription.service';
import { RealDescription } from '../entities/inventory/itemNameRealDescription.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RealDescription, ItemVariant])],
  controllers: [RealDescriptionsController],
  providers: [RealDescriptionsService],
  exports: [RealDescriptionsService],
})
export class RealDescriptionsModule {}
