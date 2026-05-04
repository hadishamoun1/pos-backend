import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { RecordingDevice } from '../entities/recording-device.entity';
import { Recording } from '../entities/recording.entity';
import { RecordingService } from './recording.service';
import { RecordingController } from './recording.controller';
import { DelayModule } from '../delay/delay.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecordingDevice, Recording]),
    MulterModule.register({}),
    DelayModule,
  ],
  providers: [RecordingService],
  controllers: [RecordingController],
})
export class RecordingModule {}
