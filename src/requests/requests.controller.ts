import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { RequestService } from './requests.service';
import { Request } from '../entities/request.entity';

@Controller('requests')
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @Post()
  async createRequest(@Body() data: any): Promise<Request> {
    return this.requestService.createRequest(data);
  }

  @Get()
  async getAllRequests(): Promise<Request[]> {
    return this.requestService.getAllRequests();
  }

  @Get(':id')
  async getRequestById(@Param('id') id: number): Promise<Request> {
    return this.requestService.getRequestById(id);
  }

  @Get('v1/filtered')
  async getFilteredRequests(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 100,
  ) {
    return this.requestService.getFilteredRequests(Number(page), Number(limit));
  }
}
