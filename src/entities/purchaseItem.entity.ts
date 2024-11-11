import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PurchaseInvoice } from './purchaseInvoice.entity';
import { Dimension } from './inventory/dimension.entity';

@Entity()
export class PurchaseItem {
  @PrimaryGeneratedColumn()
  id: number; // Unique identifier for each item in the purchase

  @ManyToOne(() => PurchaseInvoice, (purchaseInvoice) => purchaseInvoice.purchaseItems)
  @JoinColumn({ name: 'purchaseInvoiceId' })
  purchaseInvoice: PurchaseInvoice; // Link to the parent PurchaseInvoice

  @ManyToOne(() => Dimension, { eager: true })
  @JoinColumn({ name: 'dimensionId' })
  dimension: Dimension; // Reference to the specific dimension of the item being purchased

  @Column()
  quantity: number; // Quantity of the item being purchased (in boxes or sheets)

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  pricePerUnit: number; // Price per unit of the item

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalPriceUSD: number; // Total price in USD for this item (quantity * pricePerUnit)
}
