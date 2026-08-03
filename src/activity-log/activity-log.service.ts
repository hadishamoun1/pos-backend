import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from '../entities/activity-log.entity';

interface HeartbeatEntry {
  username: string;
  role: string;
  lastSeen: Date;
}

@Injectable()
export class ActivityLogService {
  // In-memory: userId -> last heartbeat
  private heartbeats = new Map<number, HeartbeatEntry>();

  constructor(
    @InjectRepository(ActivityLog)
    private repo: Repository<ActivityLog>,
  ) {}

  async log(data: {
    userId: number;
    username: string;
    action: string;
    entityType?: string;
    entityId?: number;
    description?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
  }): Promise<ActivityLog> {
    const entry = this.repo.create(data);
    return this.repo.save(entry);
  }

  heartbeat(userId: number, username: string, role: string) {
    this.heartbeats.set(userId, { username, role, lastSeen: new Date() });
  }

  getActiveUsers() {
    const now = Date.now();
    return Array.from(this.heartbeats.entries())
      .map(([userId, info]) => {
        const diffMin = (now - info.lastSeen.getTime()) / 60000;
        const status = diffMin < 2 ? 'active' : diffMin < 10 ? 'idle' : 'offline';
        return { userId, username: info.username, role: info.role, status, lastSeen: info.lastSeen };
      })
      .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  }

  async getLogs(filters: {
    userId?: number;
    from?: string;
    to?: string;
    action?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { userId, from, to, action, search, page = 1, limit = 50 } = filters;
    const qb = this.repo
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC');

    if (userId) qb.andWhere('log.userId = :userId', { userId });
    if (action) qb.andWhere('log.action = :action', { action });
    if (from) qb.andWhere('DATE(log.createdAt) >= :from', { from });
    if (to)   qb.andWhere('DATE(log.createdAt) <= :to', { to });
    if (search) qb.andWhere('log.description LIKE :search', { search: `%${search}%` });

    qb.skip((page - 1) * limit).take(limit);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getFraudAlerts() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const alerts: any[] = [];

    // Excessive deletions: 3+ in a single day
    const deletions = await this.repo
      .createQueryBuilder('log')
      .select('log.userId', 'userId')
      .addSelect('log.username', 'username')
      .addSelect('DATE(log.createdAt)', 'day')
      .addSelect('COUNT(*)', 'cnt')
      .where("log.action LIKE '%DELETE%' OR log.action LIKE '%VOID%'")
      .andWhere('log.createdAt >= :since', { since })
      .groupBy('log.userId, DATE(log.createdAt)')
      .having('COUNT(*) >= 3')
      .getRawMany();

    for (const d of deletions) {
      alerts.push({
        type: 'EXCESSIVE_DELETIONS',
        severity: 'high',
        userId: d.userId,
        username: d.username,
        day: d.day,
        count: Number(d.cnt),
        message: `${d.username} performed ${d.cnt} deletions/voids on ${d.day}`,
      });
    }

    // After-hours activity: before 06:00 or after 22:00
    const afterHours = await this.repo
      .createQueryBuilder('log')
      .where('HOUR(log.createdAt) < 6 OR HOUR(log.createdAt) >= 22')
      .andWhere('log.createdAt >= :since', { since })
      .orderBy('log.createdAt', 'DESC')
      .take(30)
      .getMany();

    for (const a of afterHours) {
      alerts.push({
        type: 'AFTER_HOURS_ACTIVITY',
        severity: 'medium',
        userId: a.userId,
        username: a.username,
        createdAt: a.createdAt,
        message: `${a.username} performed ${a.action} at ${new Date(a.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      });
    }

    // Bulk creates: 10+ creations in one hour
    const bulkCreates = await this.repo
      .createQueryBuilder('log')
      .select('log.userId', 'userId')
      .addSelect('log.username', 'username')
      .addSelect('DATE_FORMAT(log.createdAt, \'%Y-%m-%d %H:00\')', 'hour')
      .addSelect('COUNT(*)', 'cnt')
      .where("log.action LIKE '%CREATE%'")
      .andWhere('log.createdAt >= :since', { since })
      .groupBy('log.userId, DATE_FORMAT(log.createdAt, \'%Y-%m-%d %H:00\')')
      .having('COUNT(*) >= 10')
      .getRawMany();

    for (const b of bulkCreates) {
      alerts.push({
        type: 'BULK_OPERATIONS',
        severity: 'low',
        userId: b.userId,
        username: b.username,
        hour: b.hour,
        count: Number(b.cnt),
        message: `${b.username} created ${b.cnt} records in one hour (${b.hour})`,
      });
    }

    return alerts.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    });
  }

  async getActionTypes(): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('log')
      .select('DISTINCT log.action', 'action')
      .orderBy('log.action', 'ASC')
      .getRawMany();
    return rows.map((r) => r.action);
  }

  async getAllUsers(): Promise<{ userId: number; username: string }[]> {
    const rows = await this.repo
      .createQueryBuilder('log')
      .select('DISTINCT log.userId', 'userId')
      .addSelect('log.username', 'username')
      .orderBy('log.username', 'ASC')
      .getRawMany();
    return rows.map((r) => ({ userId: Number(r.userId), username: r.username }));
  }
}
