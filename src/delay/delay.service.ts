import { Injectable } from '@nestjs/common';

@Injectable()
export class DelayService {
  private delayMs = 0;
  private agentIps = new Map<string, number>(); // ip → last-seen ms

  getDelay(): number { return this.delayMs; }
  setDelay(ms: number): void { this.delayMs = Math.max(0, Math.min(30000, ms)); }

  registerAgentIp(ip: string): void { if (ip) this.agentIps.set(ip, Date.now()); }
  isAgentIp(ip: string): boolean {
    const last = this.agentIps.get(ip);
    return last !== undefined && Date.now() - last < 5 * 60 * 1000; // 5-minute TTL
  }
}
