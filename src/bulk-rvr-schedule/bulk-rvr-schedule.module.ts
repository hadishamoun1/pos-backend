import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BulkRvrSchedule } from './bulk-rvr-schedule.entity';
import { BulkRvrScheduleService } from './bulk-rvr-schedule.service';
import { BulkRvrScheduleController } from './bulk-rvr-schedule.controller';
import { InvoiceModule } from '../invoice/invoice.module';
import { RecievablesModule } from '../receipt-voucher/recievables.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BulkRvrSchedule]),
    InvoiceModule,
    RecievablesModule,
  ],
  providers: [BulkRvrScheduleService],
  controllers: [BulkRvrScheduleController],
})
export class BulkRvrScheduleModule {}
