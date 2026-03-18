import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SecurityAlert } from "../entities/security-alert.entity";
import { SecurityAlertService } from "./security-alert.service";
import { SecurityAlertController } from "./security-alert.contoller";

@Module({
  imports: [TypeOrmModule.forFeature([SecurityAlert])],
  controllers: [SecurityAlertController],
  providers: [SecurityAlertService],
  exports: [SecurityAlertService],
})
export class SecurityAlertModule {}