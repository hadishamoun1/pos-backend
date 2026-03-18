import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SecurityAlert } from "../entities/security-alert.entity";

@Injectable()
export class SecurityAlertService implements OnModuleInit {
  constructor(
    @InjectRepository(SecurityAlert)
    private readonly repo: Repository<SecurityAlert>
  ) {}

  // Ensure a single row always exists on startup
  async onModuleInit() {
    const count = await this.repo.count();
    if (count === 0) {
      await this.repo.save(this.repo.create({ isActive: false }));
    }
  }

  // Get current status
  async getStatus(): Promise<{ isActive: boolean; updatedAt: Date }> {
    const record = await this.repo.findOne({ where: { id: 1 } });
    return { isActive: record.isActive, updatedAt: record.updatedAt };
  }

  // Enable lockdown
  async enable(): Promise<{ isActive: boolean; updatedAt: Date }> {
    await this.repo.update(1, { isActive: true });
    return this.getStatus();
  }

  // Disable lockdown
  async disable(): Promise<{ isActive: boolean; updatedAt: Date }> {
    await this.repo.update(1, { isActive: false });
    return this.getStatus();
  }

  // Toggle
  async toggle(): Promise<{ isActive: boolean; updatedAt: Date }> {
    const record = await this.repo.findOne({ where: { id: 1 } });
    await this.repo.update(1, { isActive: !record.isActive });
    return this.getStatus();
  }
}