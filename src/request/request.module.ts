import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Request } from '../entities/request.entity';
import { RequestItem } from '../entities/request-item.entity';
import { RequestService } from './request.service';
import { RequestController } from './request.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Request, RequestItem])],
  providers: [RequestService],
  controllers: [RequestController],
})
export class RequestModule {}
