import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ length: 100 })
  username: string;

  @Column({ length: 100 })
  action: string;

  @Column({ length: 100, nullable: true })
  entityType: string;

  @Column({ nullable: true })
  entityId: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @Column({ length: 50, nullable: true })
  ipAddress: string;

  @CreateDateColumn()
  createdAt: Date;
}
