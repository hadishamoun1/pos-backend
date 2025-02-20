import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ItemVariant } from './itemVariant.entity';
import { InvoiceItem } from '../invoiceItem.entity';

@Entity()
export class InventoryTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ItemVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant; // Links to the item variant

  @Column({ type: 'enum', enum: ['purchase', 'sale'] })
  transactionType: string; // 'purchase' or 'sale'

  // ✅ Track inventory in square meters (sqm)
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false })
  sqm: number; // How much glass is added or removed in m²

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  transactionDate: Date;

  // ✅ Link to InvoiceItem for sales transactions
  @ManyToOne(() => InvoiceItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoiceItemId' })
  invoiceItem: InvoiceItem;

  @Column({ nullable: true })
  invoiceItemId: number; // Optional foreign key reference
}
