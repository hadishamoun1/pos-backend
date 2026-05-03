import { Injectable } from '@nestjs/common';

@Injectable()
export class DelayService {
  private delayMs = 0;

  getDelay(): number {
    return this.delayMs;
  }

  setDelay(ms: number): void {
    this.delayMs = Math.max(0, Math.min(30000, ms));
  }
}
