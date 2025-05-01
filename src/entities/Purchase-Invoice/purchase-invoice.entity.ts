import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Supplier } from '../supplier.entity';
import { PurchaseInvoiceItem } from './purchase-invoice-item.entity';
import { UnitPriceModalRow } from './unit-price-modal-row.entity.ts';
import { PurchaseVoucher } from '../Vouchers/purchaseVoucher.entity';

@Entity('purchase_invoices')
export class PurchaseInvoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', nullable: true })
  invoiceNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date', nullable: true })
  expectedArrivalDate: Date;

  @Column({
    type: 'enum',
    enum: ['S', 'G', 'SR'],
    default: 'S',
  })
  type: 'S' | 'G' | 'SR';

  @ManyToOne(() => Supplier)
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column()
  supplierId: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  vatAmount: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  grandAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  exchangeRate: number;

  @Column({
    type: 'enum',
    enum: ['Ordered', 'Shipped', 'Recieved'],
    default: 'Ordered',
  })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  shippingLine: string;

  @Column({ type: 'date', nullable: true })
  etd: string;

  @Column({ type: 'int', default: 0 })
  numberOfContainers: number;

  @Column({ type: 'varchar', nullable: true })
  blNumber: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  potentialCost: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  shippingCost: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  finalCost: number;

  @OneToMany(() => PurchaseInvoiceItem, (item) => item.invoice, {
    cascade: true,
  })
  items: PurchaseInvoiceItem[];

  @OneToMany(() => UnitPriceModalRow, (row) => row.invoice, { cascade: true })
  unitPriceRows: UnitPriceModalRow[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => PurchaseVoucher, (v) => v.purchaseInvoice)
  vouchers: PurchaseVoucher[];
}
