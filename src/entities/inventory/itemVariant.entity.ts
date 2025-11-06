// itemVariant.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Thickness } from './thickness.entity';
import { InventoryCount } from './count.entity';
import { ItemBatch } from './itemBatch.entity';
import { ItemNameDescription } from './itemNameDescription.entity';
import { RealDescription } from './itemNameRealDescription.entity'; 

@Entity()
export class ItemVariant {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Thickness, (thickness) => thickness.variants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  thickness: Thickness;

  @Column('decimal', { precision: 20, scale: 2, nullable: false })
  length: number;

  @Column('decimal', { precision: 20, scale: 2, nullable: false })
  width: number;

  @Column({ type: 'int', nullable: false })
  sheetsPerBox: number;

  @Column({ length: 50, nullable: false })
  origin: string;

  @Column({ type: 'boolean', default: false })
  fixBox: boolean;

  @Column({ type: 'boolean', default: false })
  fixLength: boolean;

  @Column({ type: 'boolean', default: false })
  fixWidth: boolean;

  // Totals
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalStart: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalIn: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalOut: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalBalance: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalStartOFR: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalInOFR: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalOutOFR: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  totalBalanceOFR: number;

  @OneToMany(() => ItemBatch, (batch) => batch.itemVariant)
  batches: ItemBatch[];

  @OneToMany(() => InventoryCount, (cnt) => cnt.itemVariant)
  inventoryCounts: InventoryCount[];

  // Legacy/primary description (kept)
  @ManyToOne(() => ItemNameDescription, { eager: false, nullable: true })
  @JoinColumn()
  itemNameDescription: ItemNameDescription;

  @Column({ nullable: true })
  itemNameDescriptionId: number;

  @ManyToOne(() => RealDescription, {
    eager: false,
    nullable: true,
   
  })
  @JoinColumn({ name: 'realDescriptionId', referencedColumnName: 'id' })
  realDescription: RealDescription | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  realDescriptionId: number | null;

  // Costs (already present in your entity)
  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  averageCost: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  averageCostVM: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  lastCost: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  lastCostVM: number;
}
