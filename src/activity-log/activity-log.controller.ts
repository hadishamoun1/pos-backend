import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityLogService } from './activity-log.service';

@Controller('activity-log')
@UseGuards(JwtAuthGuard)
export class ActivityLogController {
  constructor(private readonly service: ActivityLogService) {}

  @Post('heartbeat')
  heartbeat(@Request() req: any) {
    const { userId, username, role } = req.user;
    this.service.heartbeat(Number(userId), username, role ?? 'USER');
    return { ok: true };
  }

  @Get('active-users')
  getActiveUsers() {
    return this.service.getActiveUsers();
  }

  @Get('fraud-alerts')
  getFraudAlerts() {
    return this.service.getFraudAlerts();
  }

  @Get('action-types')
  getActionTypes() {
    return this.service.getActionTypes();
  }

  @Get('users')
  getAllUsers() {
    return this.service.getAllUsers();
  }

  @Get()
  getLogs(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getLogs({
      userId: userId ? Number(userId) : undefined,
      from,
      to,
      action,
      search: search?.trim() || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Post()
  logAction(
    @Request() req: any,
    @Body()
    body: {
      action: string;
      entityType?: string;
      entityId?: number;
      description?: string;
      metadata?: Record<string, any>;
    },
  ) {
    const { userId, username } = req.user;
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip ?? null;

    return this.service.log({
      userId: Number(userId),
      username,
      action: body.action,
      entityType: body.entityType,
      entityId: body.entityId,
      description: body.description,
      metadata: body.metadata,
      ipAddress: ip,
    });
  }
}
