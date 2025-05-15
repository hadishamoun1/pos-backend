import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PurchaseInvoice } from './purchase-invoice.entity';
import { ItemVariant } from '../inventory/itemVariant.entity';

@Entity('purchase_invoice_items')
export class PurchaseInvoiceItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.items)
  @JoinColumn({ name: 'invoiceId' })
  invoice: PurchaseInvoice;

  @Column()
  invoiceId: number;

  @ManyToOne(() => ItemVariant)
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant;

  @Column()
  itemVariantId: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  quantity: number;
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  sqm: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  euroPrice: number;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  euroOFRPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  priceOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalOFR: number;

  @Column({ type: 'int', nullable: true })
  numberOfContainers: number;


  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cfr: number;

  /** Final cost (CFR × potentialCostRatio) */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  finalCost: number;

  /** CFR calculated off the OFR price */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cfrOFR: number;

  /** Final OFR cost (CFR-OFR × potentialCostRatio) */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  finalOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  costpercentage: number;

}
