import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlternativeCustomer } from '../entities/alternative-customer.entity';
import { AlternativeCustomerService } from './alternative-customer.service';
import { AlternativeCustomerController } from './alternative-customer.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AlternativeCustomer])],
  providers: [AlternativeCustomerService],
  controllers: [AlternativeCustomerController],
  exports: [AlternativeCustomerService],
})
export class AlternativeCustomerModule {}
