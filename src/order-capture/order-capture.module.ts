import { Module } from '@nestjs/common';
import { OrderCaptureService } from './order-capture.service';
import { OrderCaptureController } from './order-capture.controller';

@Module({
  providers: [OrderCaptureService],
  controllers: [OrderCaptureController],
})
export class OrderCaptureModule {}
