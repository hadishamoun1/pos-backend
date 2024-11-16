import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { PurchaseInvoiceItem } from './purchase-invoice-item.entity';

@Entity('purchase_invoices')
export class PurchaseInvoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  invoiceNumber: string;

  @Column({ type: 'varchar', length: 1 })
  type: string; // 'S' or 'G'

  @Column()
  supplierName: string;

  @Column('decimal', { precision: 10, scale: 2 })
  exchangeRate: number;

  @Column('decimal', { precision: 10, scale: 2 })
  vatAmount: number;

  @Column('decimal', { precision: 10, scale: 2 })
  grandAmount: number;

  @Column({ type: 'date' })
  date: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => PurchaseInvoiceItem, (item) => item.purchaseInvoice, {
    cascade: true,
  })
  items: PurchaseInvoiceItem[];
}
