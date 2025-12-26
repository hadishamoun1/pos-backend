import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  Patch,
  ParseIntPipe,
} from "@nestjs/common";
import { CustomerService } from "./customer.service";
import { Customer } from "../entities/customer.entity";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("customers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  // CREATE
  @Post()
  @RequirePerms("customers.create")
  async createCustomer(@Body() customerData: Partial<Customer>): Promise<Customer> {
    return this.customerService.createCustomer(customerData);
  }

  // ✅ v1 routes MUST come before ":id"
  @Get("v1/paginated")
  @RequirePerms("customers.view")
  async getCustomersPaginated(
    @Query("page") page: string,
    @Query("limit") limit: string
  ): Promise<{ customers: Partial<Customer>[]; total: number }> {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;
    return this.customerService.getCustomersPaginated(pageNumber, pageSize);
  }

  @Get("v1/basic-details")
  @RequirePerms("customers.view")
  async getCustomerBasicDetails(): Promise<Partial<Customer>[]> {
    return this.customerService.getCustomerBasicDetails();
  }

  @Get("v1/search")
  @RequirePerms("customers.view")
  async searchCustomers(@Query("query") query: string) {
    return this.customerService.searchCustomers(query);
  }

  // VIEW (all)
  @Get()
  @RequirePerms("customers.view")
  async getAllCustomers(): Promise<Customer[]> {
    return this.customerService.getAllCustomers();
  }

  // VIEW (single)
  @Get(":id")
  @RequirePerms("customers.view")
  async getCustomerById(@Param("id", ParseIntPipe) id: number): Promise<Customer> {
    return this.customerService.getCustomerById(id);
  }

  // ✅ UPDATE
  @Patch(":id")
  @RequirePerms("customers.update")
  update(@Param("id", ParseIntPipe) id: number, @Body() body: Partial<Customer>) {
    return this.customerService.updateCustomer(id, body);
  }
}
