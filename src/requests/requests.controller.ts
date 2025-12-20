import {
  Controller,
  Put,
  Get,
  Post,
  Param,
  Body,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { RequestService } from './requests.service';
import { Request } from '../entities/request.entity';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @Post()
  @RequirePerms('requests.create')
  async createRequest(@Body() data: any): Promise<Request> {
    return this.requestService.createRequest(data);
  }

  @Get()
  @RequirePerms('requests.view')
  async getAllRequests(): Promise<Request[]> {
    return this.requestService.getAllRequests();
  }

  @Get(':id')
  @RequirePerms('requests.view')
  async getRequestById(@Param('id') id: number): Promise<Request> {
    return this.requestService.getRequestById(id);
  }

  @Get('v1/filtered')
  @RequirePerms('requests.view')
  getFilteredRequests(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.requestService.getFilteredRequests(page, limit);
  }

  @Get('v1/filtered/search')
  @RequirePerms('requests.view')
  async search(
    @Query('q') q?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '100',
  ) {
    return this.requestService.searchFilteredRequests(
      q,
      Number(page),
      Number(limit),
    );
  }

  @Put(':id')
  @RequirePerms('requests.update')
  async updateRequest(
    @Param('id') id: number,
    @Body() data: any,
  ): Promise<Request> {
    return this.requestService.updateRequest(id, data);
  }
}
