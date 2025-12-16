import { Body, Controller, Post } from '@nestjs/common';
import { RecomputeCostsService } from './recompute.service';

@Controller('recompute')
export class RecomputeCostsController {
  constructor(private readonly svc: RecomputeCostsService) {}

  @Post('recompute-costs')
  recompute(@Body() body: { fromDate: string }) {
    return this.svc.recomputeFromDate(body.fromDate);
  }
}
