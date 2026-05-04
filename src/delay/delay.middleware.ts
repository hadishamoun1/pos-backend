import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DelayService } from './delay.service';

@Injectable()
export class DelayMiddleware implements NestMiddleware {
  constructor(private readonly delayService: DelayService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const ms = this.delayService.getDelay();
    if (ms <= 0) { next(); return; }
    const raw = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const ip = raw.replace(/^::ffff:/, '');
    if (this.delayService.isAgentIp(ip)) { next(); return; }
    setTimeout(next, ms);
  }
}
