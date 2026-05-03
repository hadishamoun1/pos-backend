import { Module } from '@nestjs/common';
import { DelayService } from './delay.service';
import { DelayMiddleware } from './delay.middleware';

@Module({
  providers: [DelayService, DelayMiddleware],
  exports: [DelayService, DelayMiddleware],
})
export class DelayModule {}
