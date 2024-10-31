import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Customer } from './customer.entity';

@Entity()
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  invoiceType: string; // "S" or "G"

  @Column()
  invoiceNumber: string; // Unique within each type, e.g., "24-1" or "G-1"

  @ManyToOne(() => Customer, (customer) => customer.invoices)
  customer: Customer;

  @Column()
  invoiceYear: string; // The year prefix used when the invoice was created

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  exchangeRate: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalAmountUSDWithVAT: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalAmountUSDWithoutVAT: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalVATLBP: number;

  @Column({ default: 'approved' })
  status: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
