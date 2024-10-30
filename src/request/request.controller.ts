import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { RequestService } from './request.service';
import { Request } from '../entities/request.entity';
import { RequestItem } from '../entities/request-item.entity';

@Controller('requests')
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @Post()
  async createRequest(@Body() data: { request: Partial<Request>; items: Partial<RequestItem>[] }): Promise<Request> {
    const { request, items } = data;
    return this.requestService.createRequest(request, items);
  }

  @Get()
  async findAll(): Promise<Request[]> {
    return this.requestService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: number): Promise<Request> {
    return this.requestService.findOne(id);
  }

  @Put(':id')
  async updateRequest(@Param('id') id: number, @Body() data: Partial<Request>): Promise<Request> {
    return this.requestService.updateRequest(id, data);
  }

  @Delete(':id')
  async deleteRequest(@Param('id') id: number): Promise<void> {
    return this.requestService.deleteRequest(id);
  }
}
