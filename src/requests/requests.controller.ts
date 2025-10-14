import { Controller, Put,Get, Post, Param, Body, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
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
getFilteredRequests(
  @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
) {
  return this.requestService.getFilteredRequests(page, limit);
}


  @Put(':id')
  async updateRequest(
    @Param('id') id: number,
    @Body() data: any,
  ): Promise<Request> {
    return this.requestService.updateRequest(id, data);
  }
}
