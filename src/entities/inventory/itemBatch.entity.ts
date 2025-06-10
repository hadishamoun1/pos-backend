import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToMany,
  JoinColumn,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ItemVariant } from './itemVariant.entity';

@Entity()
export class ItemBatch {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ItemVariant, (variant) => variant.batches, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  itemVariant: ItemVariant;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  condition: string;

  @Column({ type: 'date', nullable: true, default: null })
  dateReceived: Date;

  // 🔽 Inventory Tracking (TOTALS)
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  start: number; // Initial balance

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  in: number; // Total purchases

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  out: number; // Total sales

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance: number; // Calculated as (start + in - out)

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  startOFR: number; // Initial balance
  
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  inOFR: number; // Total purchases

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  outOFR: number; // Total sales

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balanceOFR: number;

}
