import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { PurchaseInvoice } from './purchaseInvoice.entity';
import { Dimension } from './inventory/dimension.entity';

@Entity('purchase_invoice_items')
export class PurchaseInvoiceItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.items, {
    onDelete: 'CASCADE',
  })
  purchaseInvoice: PurchaseInvoice;

  @ManyToOne(() => Dimension, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dimensionId' })
  dimension: Dimension;

  @Column('decimal', { precision: 10, scale: 2 })
  sqm: number;

  @Column('decimal', { precision: 10, scale: 2 })
  unitPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  totalAmount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
