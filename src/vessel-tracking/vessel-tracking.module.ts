import { Module } from '@nestjs/common';
import { VesselTrackingService } from './vessel-tracking.service';

@Module({
  providers: [VesselTrackingService],
  exports: [VesselTrackingService],
})
export class VesselTrackingModule {}
