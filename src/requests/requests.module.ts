import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Request } from '../entities/request.entity';
import { RequestDetail } from '../entities/requestDetails.entity';
import { Customer } from '../entities/customer.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { RequestService } from './requests.service';
import { RequestController } from './requests.controller';
import { Settings } from '../entities/settings.entity';
import { RequestGateway } from './requests.gateway'; //
import { ItemBatch } from '../entities/inventory/itemBatch.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Request,
      RequestDetail,
      Customer,
      ItemVariant,
      Settings,
      ItemBatch
    ]),
  ],
  providers: [RequestService, RequestGateway],
  controllers: [RequestController],
})
export class RequestModule {}
