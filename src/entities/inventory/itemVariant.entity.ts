import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Thickness } from './thickness.entity';
import { InventoryCount } from './count.entity';
import { ItemBatch } from './itemBatch.entity';
import { ItemNameDescription } from './itemNameDescription.entity';

@Entity()
export class ItemVariant {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Thickness, (thickness) => thickness.variants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  thickness: Thickness; // Reference to the parent Thickness

  @Column('decimal', { precision: 20, scale: 2, nullable: false })
  length: number; // Length of the item

  @Column('decimal', { precision: 20, scale: 2, nullable: false })
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
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalStart: number; // Initial balance

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalIn: number; // Total purchases

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalOut: number; // Total sales

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalBalance: number; // Calculated as (start + in - out)

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalStartOFR: number; // Initial balance
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalInOFR: number; // Total purchases

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalOutOFR: number; // Total sales

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalBalanceOFR: number;

  @OneToMany(() => ItemBatch, (batch) => batch.itemVariant)
  batches: ItemBatch[];

  @OneToMany(() => InventoryCount, (cnt) => cnt.itemVariant)
  inventoryCounts: InventoryCount[];

  @ManyToOne(() => ItemNameDescription, { eager: false, nullable: true })
  @JoinColumn()
  itemNameDescription: ItemNameDescription;

  @Column({ nullable: true })
  itemNameDescriptionId: number;
  
}
