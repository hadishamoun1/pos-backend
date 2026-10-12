import { Module } from '@nestjs/common';
import { ShipsgoService } from './shipsgo.service';
import { ShipsgoController } from './shipsgo.controller';

@Module({
  controllers: [ShipsgoController],
  providers: [ShipsgoService],
  exports: [ShipsgoService],
})
export class ShipsgoModule {}
