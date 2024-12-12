import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';
import { Customer } from './customer.entity';
import { Branch } from './branch.entity';
import { Currency } from './currency.entity';
import { InvoiceItem } from './invoice-item.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, (customer) => customer.invoices)
  customer: Customer;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'enum', enum: ['S', 'G'] })
  invoiceType: 'S' | 'G';

  @Column({ type: 'varchar', length: 50 })
  invoiceNumber: string;

  @Column({ type: 'varchar', length: 50 })
  documentNumber: string;

  @ManyToOne(() => Branch, (branch) => branch.invoices)
  branch: Branch;

  @ManyToOne(() => Currency, (currency) => currency.invoices)
  currency: Currency;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalWithoutVAT: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalVAT: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  grandTotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  currencyRate: number;

  @OneToMany(() => InvoiceItem, (item) => item.invoice)
  items: InvoiceItem[];
}
