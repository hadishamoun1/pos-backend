// src/entities/inventory/transferItem.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Transfer } from './transfer.entity';
import { ItemVariant } from './itemVariant.entity';

@Entity({ name: 'transfer_items' })
export class TransferItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transfer, (t) => t.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transferId' })
  transfer: Transfer;
  @Column()
  transferId: number;

  @ManyToOne(() => ItemVariant, { eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant;
  @Column({ nullable: true })
  itemVariantId: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  sqm: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number;
}
