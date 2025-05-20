import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ItemVariant } from './itemVariant.entity';
import { InvoiceItem } from '../invoiceItem.entity';
import { PurchaseInvoiceItem } from '../Purchase-Invoice/purchase-invoice-item.entity';

@Entity()
export class InventoryTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ItemVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant; // Links to the item variant
  @Column()
  itemVariantId: number;

  @Column({ type: 'varchar', length: 20 })
  transactionType: string;

  // ✅ Track inventory in square meters (sqm)
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false })
  sqm: number; // How much glass is added or removed in m²

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false })
  sqmofr: number; // How much glass is added or removed in m²

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  quantityofr: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  transactionDate: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  finalcost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  finalcostofr: number;

  // ✅ Link to InvoiceItem for sales transactions
  @ManyToOne(() => InvoiceItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoiceItemId' })
  invoiceItem: InvoiceItem;

  @Column({ nullable: true })
  invoiceItemId: number; // Optional foreign key reference

  // ↳ purchase‐invoice link (new)
  @ManyToOne(() => PurchaseInvoiceItem, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'purchaseInvoiceItemId' })
  purchaseInvoiceItem: PurchaseInvoiceItem;
  @Column({ nullable: true })
  purchaseInvoiceItemId: number;
}
