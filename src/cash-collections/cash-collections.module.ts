// src/cash-collections/cash-collections.module.ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CashCollection } from "../entities/cash-collection.entity";
import { CashCollectionApprovalRequest } from "../entities/cash-collection-approval.entity";
import { CashCollectionsController } from "./cash-collections.controller";
import { CashCollectionsService } from "./cash-collections.service";

@Module({
  imports: [TypeOrmModule.forFeature([CashCollection, CashCollectionApprovalRequest])],
  controllers: [CashCollectionsController],
  providers: [CashCollectionsService],
  exports: [CashCollectionsService],
})
export class CashCollectionsModule {}
