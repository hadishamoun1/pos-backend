import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('bulk_rvr_schedule')
export class BulkRvrSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: false })
  enabled: boolean;

  @Column({ default: 1 })
  quantity: number;

  // Invoice fields
  @Column({ nullable: true })
  invoiceCustomerId: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  invoiceCustomerName: string;

  @Column({ nullable: true })
  invoiceItemVariantId: number;

  @Column({ nullable: true })
  invoiceItemBatchId: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceItemType: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceItemStockMode: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  invoiceItemName: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  invoiceUnitPrice: number;

  // Receivable fields
  @Column({ nullable: true })
  receivableCustomerId: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  receivableCustomerName: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  receivableCashAmount: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  receivableCurrency: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 89500 })
  receivableExchangeRate: number;

  // Schedule
  @Column({ default: 0, comment: '0-23, hour of day to run (server local time)' })
  runHour: number;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: 'Comma-separated day numbers 0=Sun…6=Sat. NULL/empty = all days.' })
  allowedDays: string;

  @Column({ type: 'timestamp', nullable: true })
  lastRunAt: Date;

  @Column({ type: 'text', nullable: true })
  lastRunResult: string;

  // RVR Randomizer item pool — stored as JSON array of variant objects
  @Column({ type: 'text', nullable: true })
  rvrItemPool: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
