import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { Customer } from '../entities/customer.entity';
import { Query } from '@nestjs/common';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  async createCustomer(
    @Body() customerData: Partial<Customer>,
  ): Promise<Customer> {
    return this.customerService.createCustomer(customerData);
  }

  @Get()
  async getAllCustomers(): Promise<Customer[]> {
    return this.customerService.getAllCustomers();
  }

  @Get(':id')
  async getCustomerById(@Param('id') id: number): Promise<Customer> {
    return this.customerService.getCustomerById(id);
  }

  @Get('v1/paginated')
  async getCustomersPaginated(
    @Query('page') page: string,
    @Query('limit') limit: string,
  ): Promise<{ customers: Partial<Customer>[]; total: number }> {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;
    return this.customerService.getCustomersPaginated(pageNumber, pageSize);
  }
  @Get('v1/basic-details')
  async getCustomerBasicDetails(): Promise<Partial<Customer>[]> {
    return this.customerService.getCustomerBasicDetails();
  }
}
