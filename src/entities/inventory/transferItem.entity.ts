// src/entities/inventory/transferItem.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Transfer } from './transfer.entity';
import { ItemVariant } from './itemVariant.entity';
import { ItemBatch } from './itemBatch.entity';
import { SqmPiece } from './sqmPiece.entity';

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
  @ManyToOne(() => ItemBatch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'itemBatchId' })
  itemBatch: ItemBatch;

  @Column({ nullable: true })
  itemBatchId: number;


    @OneToMany(() => SqmPiece, (p) => p.transferItem)
  sqmPieces: SqmPiece[];
}
