import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Branch } from './branch.entity';
import { Currency } from './currency.entity';
import { InvoiceItem } from './invoiceItem.entity';
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, (customer) => customer.invoices)
  @JoinColumn({ name: 'customerId' }) // Links the `customerId` foreign key
  customer: Customer;

  @Column()
  customerId: number; // Foreign key for Customer

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'enum', enum: ['S', 'G', 'RVR'] })
  invoiceType: 'S' | 'G' | 'RVR'; 

  @Column({ type: 'varchar', length: 50 })
  invoiceNumber: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  documentNumber: string;

  @ManyToOne(() => Branch, (branch) => branch.invoices)
  @JoinColumn({ name: 'branchId' })
  branch: Branch;

  @Column({ nullable: true })
  branchId: number;

  @ManyToOne(() => Currency, (currency) => currency.invoices)
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @Column({ nullable: true })
  currencyId: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalWithoutVAT: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalVAT: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  grandTotal: number;

  @Column({ type: 'decimal', precision: 20, scale: 4 })
  currencyRate: number;

  @Column({ type: 'decimal', precision: 20, scale: 4 })
  vatPercentage: number;

  @OneToMany(() => InvoiceItem, (item) => item.invoice)
  items: InvoiceItem[];

  @OneToMany(() => SalesVoucher, (salesVoucher) => salesVoucher.invoice)
  salesVouchers: SalesVoucher[];


}
