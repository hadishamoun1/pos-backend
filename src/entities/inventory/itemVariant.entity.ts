import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Thickness } from './thickness.entity';

@Entity()
export class ItemVariant {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Thickness, (thickness) => thickness.variants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  thickness: Thickness; // Reference to the parent Thickness

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  length: number; // Length of the item

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  width: number; // Width of the item

  @Column({ type: 'int', nullable: false })
  sheetsPerBox: number; // Number of sheets per box

  @Column({ length: 50, nullable: false })
  origin: string; // Origin of the item

  @Column({ type: 'boolean', default: false })
  fixBox: boolean; // Whether the box size is fixed

  @Column({ type: 'boolean', default: false })
  fixLength: boolean; // Whether the length is fixed

  @Column({ type: 'boolean', default: false })
  fixWidth: boolean; // Whether the width is fixed

  // 🔽 Inventory Tracking (TOTALS)
  @Column({ type: 'int', default: 0 })
  start: number; // Initial balance

  @Column({ type: 'int', default: 0 })
  in: number; // Total purchases

  @Column({ type: 'int', default: 0 })
  out: number; // Total sales

  @Column({ type: 'int', default: 0 })
  balance: number; // Calculated as (start + in - out)

  
  @Column({ type: 'int', default: 0 })
  startOFR: number; // Initial balance
  @Column({ type: 'int', default: 0 })
  inOFR: number; // Total purchases

  @Column({ type: 'int', default: 0 })
  outOFR: number; // Total sales

  @Column({ type: 'int', default: 0 })
  balanceOFR: number;
}
