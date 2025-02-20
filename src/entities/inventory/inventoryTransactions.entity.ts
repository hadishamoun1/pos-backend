import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
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

  @Column({ type: 'int', nullable: false })
  quantity: number; // Quantity added or removed

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  transactionDate: Date;

  // 🔽 New Foreign Key to Link to InvoiceItem
  @ManyToOne(() => InvoiceItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoiceItemId' })
  invoiceItem: InvoiceItem;

  @Column({ nullable: true })
  invoiceItemId: number; // Optional foreign key reference
}
