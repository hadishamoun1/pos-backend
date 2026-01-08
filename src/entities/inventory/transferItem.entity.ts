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
import { SqmPiece } from './SqmPiece.entity';
import { InvoiceItem } from '../invoiceItem.entity';

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

  // Existing: used as "price/cost" for the line (you already use this in places)
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number;

  // ✅ New fields you asked for
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, nullable: true })
  averageCost: number;
  
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, nullable: true })
  averageCostVM: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, nullable: true })
  averageCostCVM: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, nullable: true })
  averageCostC: number;

  // ✅ NEW: Target item variant for FJ transfers (sheet → box conversion)
  @Column({ type: 'int', nullable: true })
  toItemVariantId: number | null;

  @ManyToOne(() => ItemBatch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'itemBatchId' })
  itemBatch: ItemBatch;

  @Column({ nullable: true })
  itemBatchId: number;

  @Column('decimal', { precision: 12, scale: 4, default: 0 })
  sqmTrashUnallocated: number;

  @OneToMany(() => SqmPiece, (p) => p.transferItem)
  sqmPieces: SqmPiece[];

  @ManyToOne(() => InvoiceItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoiceItemId' })
  invoiceItem?: InvoiceItem | null;

  @Column({ type: 'int', nullable: true })
  invoiceItemId?: number | null;
}