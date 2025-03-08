import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity'; // Import the ItemVariant entity

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;

  // 🔽 New Foreign Key to Link Item Variants
  @ManyToOne(() => ItemVariant)
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant;

  @Column()
  itemVariantId: number; // Foreign key for ItemVariant

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
