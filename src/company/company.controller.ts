// src/company/company.controller.ts
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, ParseIntPipe } from "@nestjs/common";
import { CompanyService } from "./company.service";

@Controller("company")
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  create(@Body("companyName") companyName: string) {
    return this.companyService.create(companyName);
  }

  @Get()
  findAll() {
    return this.companyService.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.companyService.findOne(id);
  }

  @Put(":id")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body("companyName") companyName: string
  ) {
    return this.companyService.update(id, companyName);
  }

  @Patch(":id/activate")
  setActive(@Param("id", ParseIntPipe) id: number) {
    return this.companyService.setActive(id);
  }

  @Delete(":id")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.companyService.remove(id);
  }
}