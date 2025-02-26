import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { Customer } from '../entities/customer.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity'; 
import { RequestService } from './requests.service';
import { RequestController } from './requests.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Request, RequestDetail, Customer, ItemVariant]), 
  ],
  providers: [RequestService],
  controllers: [RequestController],
})
export class RequestModule {}
