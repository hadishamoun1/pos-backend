import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Classification } from '../entities/classification.entity';
import { ClassificationService } from './classification.service';
import { ClassificationController } from './classification.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Classification])],
  providers: [ClassificationService],
  controllers: [ClassificationController],
})
export class ClassificationModule {}
