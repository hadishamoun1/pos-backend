import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PurchaseItem } from './purchaseItem.entity';
import { Supplier } from './suppliers.entity';
@Entity()
export class PurchaseInvoice {
  @PrimaryGeneratedColumn()
  id: number; // Unique identifier for each purchase invoice

  @ManyToOne(() => Supplier, (supplier) => supplier.purchaseInvoices, {
    eager: true,
  })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier; // Link to the supplier

  @Column({ type: 'date' })
  purchaseDate: Date; // Date of the purchase

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalAmountUSD: number; // Total amount for the purchase in USD

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  exchangeRate: number; // Exchange rate if currency conversion is needed

  @Column()
  status: string; // Status of the invoice, e.g., "pending," "completed"

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @OneToMany(
    () => PurchaseItem,
    (purchaseItem) => purchaseItem.purchaseInvoice,
    { cascade: true },
  )
  purchaseItems: PurchaseItem[];
}
