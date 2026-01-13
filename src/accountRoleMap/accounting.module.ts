import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../entities/account.entity';
import { AccountRoleMap } from '../entities/accountRoleMap.entity';
import { AccountingResolverService } from './accounting-resolver.service';
import { AccountRoleMapService } from './account-role-map.service';
import { AccountingController } from './accounting.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AccountRoleMap, Account])],
  providers: [AccountingResolverService, AccountRoleMapService],
  controllers: [AccountingController],
  exports: [AccountingResolverService], // so other modules (sales) can inject it
})
export class AccountingModule {}
