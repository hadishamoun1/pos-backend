import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../entities/company.entity';

@Injectable()
export class DelayService implements OnModuleInit {
  private delayMs = 0;
  private agentIps = new Map<string, number>();

  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
  ) {}

  async onModuleInit() {
    try {
      const active = await this.companyRepo.findOne({ where: { isActive: true } });
      if (active) this.delayMs = active.apiDelayMs ?? 0;
    } catch {}
  }

  getDelay(): number { return this.delayMs; }

  async setDelay(ms: number): Promise<void> {
    this.delayMs = Math.max(0, Math.min(30000, ms));
    try {
      const active = await this.companyRepo.findOne({ where: { isActive: true } });
      if (active) {
        active.apiDelayMs = this.delayMs;
        await this.companyRepo.save(active);
      }
    } catch {}
  }

  registerAgentIp(ip: string): void { if (ip) this.agentIps.set(ip, Date.now()); }
  isAgentIp(ip: string): boolean {
    const last = this.agentIps.get(ip);
    return last !== undefined && Date.now() - last < 5 * 60 * 1000;
  }
}
