// src/entities/UnitPriceModalRow.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PurchaseInvoice } from './purchase-invoice.entity';
import { PurchaseInvoiceSetting } from '../purchaseInvoiceSettings';
import { Supplier } from '../supplier.entity';

@Entity('unit_price_modal_rows')
export class UnitPriceModalRow {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.unitPriceRows)
  @JoinColumn({ name: 'invoiceId' })
  invoice: PurchaseInvoice;

  @Column()
  invoiceId: number;

  @ManyToOne(() => PurchaseInvoiceSetting, { nullable: true })
  @JoinColumn({ name: 'purchaseInvoiceSettingId' })
  purchaseInvoiceSetting: PurchaseInvoiceSetting;

  @Column()
  purchaseInvoiceSettingId: number;

  // optional snapshot of the name
  @Column({ type: 'varchar', length: 255, nullable: true })
  chargeName?: string;

  @Column({ type: 'enum', enum: ['amount', 'percent'], default: 'amount' })
  chargeType: 'amount' | 'percent';

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  value: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  valueOFR: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  valueExch: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  valueExchOFR: number;

  @Column({ type: 'boolean', default: true })
  addToItemCost: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  invoiceNbTax: string;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ nullable: true })
  supplierId: number;

  @Column({ type: 'boolean', default: true })
  shipping: boolean;
}
