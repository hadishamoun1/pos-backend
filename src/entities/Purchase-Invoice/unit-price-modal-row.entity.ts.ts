import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PurchaseInvoice } from './purchase-invoice.entity';

@Entity('unit_price_modal_rows')
export class UnitPriceModalRow {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.unitPriceRows)
  @JoinColumn({ name: 'invoiceId' })
  invoice: PurchaseInvoice;

  @Column()
  invoiceId: number;

  @Column({ type: 'varchar' })
  chargeName: string;

  @Column({ type: 'enum', enum: ['amount', 'percent'], default: 'amount' })
  chargeType: 'amount' | 'percent';

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  value: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  valueOFR: number;

  @Column({ type: 'varchar' })
  currency: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  valueExch: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  valueExchOFR: number;

  @Column({ type: 'boolean', default: true })
  addToItemCost: boolean;

  @Column({ type: 'varchar', nullable: true })
  invoiceNbTax: string;

  @Column({ type: 'varchar', nullable: true })
  supplierOfTax: string;

  @Column({ type: 'varchar', nullable: true })
  accNbOfSupplier: string;

  @Column({ type: 'boolean', default: true })
  shipping: boolean;
}
