import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PosControls } from "../entities/pos-controls.entity";
import { PosControlsService } from "./pos-controls.service";
import { PosControlsController } from "./pos-controls.controller";
import { PosControlsGateway } from "./pos-controls.gateway";

@Module({
  imports: [TypeOrmModule.forFeature([PosControls])],
  controllers: [PosControlsController],
  providers: [PosControlsService, PosControlsGateway],
  exports: [PosControlsService],
})
export class PosControlsModule {}
