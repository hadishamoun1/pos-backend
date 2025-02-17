import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { RequestService } from "./requests.service";
import { Request } from "../entities/request.entity";

@Controller("requests")
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

  @Get(":id")
  async getRequestById(@Param("id") id: number): Promise<Request> {
    return this.requestService.getRequestById(id);
  }

  @Get('v1/filtered')
  async getFilteredRequests() {
    return this.requestService.getFilteredRequests();
  }
}
