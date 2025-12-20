// src/users/user.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './user.service';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // List all users (without passwordHash)
  @Get()
  @RequirePerms('users.manage')
  async listUsers() {
    return this.usersService.listUsersSafe();
  }

  // Update a user's permissions
  @Patch(':id/permissions')
  @RequirePerms('users.manage')
  async setPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { permissions: string[] },
  ) {
    return this.usersService.setPermissions(id, body.permissions || []);
  }

  // Update a user's role
  @Patch(':id/role')
  @RequirePerms('users.manage')
  async setRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { role: string },
  ) {
    return this.usersService.setRole(id, body.role);
  }
}
