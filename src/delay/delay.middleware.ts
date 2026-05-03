import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DelayService } from './delay.service';

@Injectable()
export class DelayMiddleware implements NestMiddleware {
  constructor(private readonly delayService: DelayService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const ms = this.delayService.getDelay();
    if (ms > 0) {
      setTimeout(next, ms);
    } else {
      next();
    }
  }
}
