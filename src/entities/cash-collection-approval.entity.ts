import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { User } from './user.entity';
import { CashCollection } from './cash-collection.entity';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

@Entity('cash_collection_approval_requests')
export class CashCollectionApprovalRequest {
  @PrimaryGeneratedColumn()
  id: number;

  // ── Data to create if approved ──────────────────────────────────
  @Column({ type: 'varchar', length: 10 })
  date: string;

  @Column()
  customerId: number;

  @ManyToOne(() => Customer, { eager: true, nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: string;

  @Column({ nullable: true })
  currencyId: number;

  @Column({ type: 'varchar', length: 20, default: 'CASH' })
  method: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  driverName: string;

  // ── Audit ───────────────────────────────────────────────────────
  @Column()
  requestedByEmployeeId: number;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn({ name: 'requestedByEmployeeId' })
  requestedBy: User;

  @Column({ nullable: true })
  conflictingEntryId: number;

  @ManyToOne(() => CashCollection, { eager: true, nullable: true })
  @JoinColumn({ name: 'conflictingEntryId' })
  conflictingEntry: CashCollection;

  // ── Review ──────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: ApprovalStatus;

  @Column({ nullable: true })
  reviewedByAdminId: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewedByAdminId' })
  reviewedBy: User;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
