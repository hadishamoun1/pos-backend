import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// A receipt someone checked in the Receivable Duplicate Audit and confirmed is
// not a duplicate, so later scans stop flagging it as a suspect.
@Entity('receivable_audit_reviews')
export class ReceivableAuditReview {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  receiptEntryId: number;

  @Column({ type: 'int', nullable: true })
  reviewedByUserId: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  reviewedByUsername: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
