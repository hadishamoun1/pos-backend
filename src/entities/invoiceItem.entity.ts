import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity'; // Import the ItemVariant entity
import { ItemBatch } from './inventory/itemBatch.entity';

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;

  @Column({ nullable: true })
  invoiceId: number;

  // 🔽 New Foreign Key to Link Item Variants
  @ManyToOne(() => ItemVariant)
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant;

  @Column({ nullable: true })
  itemVariantId: number;

  @ManyToOne(() => ItemBatch, { eager: true })
  @JoinColumn({ name: 'itemBatchId' })
  itemBatch: ItemBatch;

  @Column({ nullable: true })
  itemBatchId: number;

  // Keep only necessary fields (remove duplicate item info)
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  sqm: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  vat: number;
  @Column({ type: 'int', default: 1 })
  quantity: number;
}
