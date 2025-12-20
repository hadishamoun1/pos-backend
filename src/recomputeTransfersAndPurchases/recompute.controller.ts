import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RecomputeCostsService } from './recompute.service';

// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('recompute')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RecomputeCostsController {
  constructor(private readonly svc: RecomputeCostsService) {}

  @Post('recompute-costs')
  @RequirePerms('recompute.run')
  recompute(@Body() body: { fromDate: string }) {
    return this.svc.recomputeFromDate(body.fromDate);
  }
}
