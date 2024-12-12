import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Put,
  Delete,
} from '@nestjs/common';
import { BranchService } from './branch.service';
import { Branch } from '../entities/branch.entity';

@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  async create(@Body('branchName') branchName: string): Promise<Branch> {
    return await this.branchService.create(branchName);
  }

  @Get()
  async findAll(): Promise<Branch[]> {
    return await this.branchService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: number): Promise<Branch> {
    return await this.branchService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: number,
    @Body('branchName') branchName: string,
  ): Promise<Branch> {
    return await this.branchService.update(id, branchName);
  }

  @Delete(':id')
  async delete(@Param('id') id: number): Promise<void> {
    return await this.branchService.delete(id);
  }
}
