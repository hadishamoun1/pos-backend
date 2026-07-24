import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Warehouse } from "../entities/warehouse.entity";
import { WarehouseService } from "./warehouse.service";
import { WarehouseController } from "./warehouse.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Warehouse])],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
