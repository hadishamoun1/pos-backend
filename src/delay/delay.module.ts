import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DelayService } from './delay.service';
import { DelayMiddleware } from './delay.middleware';
import { Company } from '../entities/company.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  providers: [DelayService, DelayMiddleware],
  exports: [DelayService, DelayMiddleware],
})
export class DelayModule {}
