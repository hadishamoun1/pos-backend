// src/employees/employees.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeesService } from './Employee.service';
import { EmployeesController } from './Employee.controller';
import { Employee } from '../entities/Employee.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Employee])],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}