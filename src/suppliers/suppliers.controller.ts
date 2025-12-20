import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupplierService } from './suppliers.service';
import { Supplier } from '../entities/supplier.entity';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  // Create a supplier
  @Post()
  @RequirePerms('suppliers.create')
  createSupplier(
    @Body() supplierData: Partial<Supplier> & { currencyId: number },
  ): Promise<Supplier> {
    return this.supplierService.createSupplier(supplierData);
  }

  // Get all suppliers
  @Get()
  @RequirePerms('suppliers.view')
  getAllSuppliers(): Promise<Supplier[]> {
    return this.supplierService.getAllSuppliers();
  }

  // Get a specific supplier by ID
  @Get(':id')
  @RequirePerms('suppliers.view')
  getSupplierById(@Param('id') id: number): Promise<Supplier> {
    return this.supplierService.getSupplierById(id);
  }

  // Delete a supplier by ID
  @Delete(':id')
  @RequirePerms('suppliers.delete')
  deleteSupplier(@Param('id') id: number): Promise<void> {
    return this.supplierService.deleteSupplier(id);
  }

  // Get paginated suppliers
  @Get('v1/paginated')
  @RequirePerms('suppliers.view')
  getSuppliersPaginated(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ): Promise<{ suppliers: Partial<Supplier>[]; total: number }> {
    return this.supplierService.getSuppliersPaginated(Number(page), Number(limit));
  }

  // Get filtered suppliers
  @Get('v1/filtered')
  @RequirePerms('suppliers.view')
  getFilteredSuppliers(): Promise<Partial<Supplier>[]> {
    return this.supplierService.getFilteredSuppliers();
  }

  // search for suggestions
  @Get('v1/search')
  @RequirePerms('suppliers.view')
  async searchSuppliers(@Query('query') query: string) {
    return this.supplierService.searchSuppliers(query);
  }
}
