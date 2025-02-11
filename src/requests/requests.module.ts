import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { RequestService } from './requests.service';
import { RequestController } from './requests.controller';
import { Customer } from '../entities/customer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Request, RequestDetail, Customer])],
  providers: [RequestService],
  controllers: [RequestController],
})
export class RequestModule {}
