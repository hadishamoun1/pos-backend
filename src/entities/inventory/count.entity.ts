import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { ItemVariant } from './itemVariant.entity';
import { InventoryTransaction } from './inventoryTransactions.entity';

export enum CountType {
  S = 'S',
  G = 'G',
  SR = 'SR',
  RVR = 'RVR',
}

@Entity({ name: 'inventory_count' })
export class InventoryCount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  itemVariantId!: number;

  @ManyToOne(() => ItemVariant, (variant) => variant.inventoryCounts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant!: ItemVariant;

  /** only the date portion, YYYY-MM-DD */
  @Column({
    type: 'date',
    transformer: {
      // when writing to the DB we accept a Date or a YYYY‑MM‑DD string
      to: (value: Date | string) =>
        value instanceof Date ? value.toISOString().slice(0, 10) : value,
      // when reading from the DB we’ll return a Date set at midnight UTC
      from: (value: string) =>
        value ? new Date(value + 'T00:00:00.000Z') : null,
    },
  })
  date!: string;

  /** counted quantity */
  @Column({ type: 'int' })
  count!: number;

  /** one of S, G, SR, RVR */
  @Column({
    type: 'enum',
    enum: CountType,
  })
  type!: CountType;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, default: 0 })
  sqm!: number;
  
   @Column('decimal', { precision: 10, scale: 2, nullable: true, default: 0 })
  sqmOfr!: number;


  /** final cost for this count */
  @Column('decimal', { precision: 10, scale: 2, nullable: true, default: 0 })
  finalCost!: number;

  /** final cost OFR for this count */
  @Column('decimal', { precision: 10, scale: 2, nullable: true, default: 0 })
  finalCostOfr!: number;

  @OneToMany(() => InventoryTransaction, (txn) => txn.inventoryCount, {
    cascade: true,
  })
  inventoryTransactions!: InventoryTransaction[];
}
