import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PosControls } from "../entities/pos-controls.entity";
import { PosControlsService } from "./pos-controls.service";
import { PosControlsController } from "./pos-controls.controller";

@Module({
  imports: [TypeOrmModule.forFeature([PosControls])],
  controllers: [PosControlsController],
  providers: [PosControlsService],
  exports: [PosControlsService],
})
export class PosControlsModule {}
