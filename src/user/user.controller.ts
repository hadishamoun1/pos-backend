// src/users/user.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
  Request,
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
  @RequirePerms('users.list')
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

  @Delete(':id')
  @RequirePerms('users.manage')
  async deleteUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.deleteUser(id);
  }

  @Patch(':id/password')
  @RequirePerms('users.manage')
  async changePassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { password: string },
  ) {
    if (!body?.password || body.password.length < 4) {
      throw new BadRequestException('Password must be at least 4 characters');
    }
    return this.usersService.changePassword(id, body.password);
  }

  // ✅ NEW: Update current user's language preference
  @Patch('me/language')
  async updateMyLanguage(
    @Request() req: any,
    @Body() body: { language: string },
  ) {
    const userId = req.user?.userId || req.user?.sub;
    return this.usersService.updateLanguage(userId, body.language);
  }

  // ✅ NEW: Get current user's profile
  @Get('me')
  async getMyProfile(@Request() req: any) {
    const userId = req.user?.userId || req.user?.sub;
    return this.usersService.getUserProfile(userId);
  }
}