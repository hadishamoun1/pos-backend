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
import { SqmPiece } from './inventory/SqmPiece.entity';

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

  @Column({ type: 'enum', enum: ['S', 'G', 'RVR', 'RTN', 'RRVR'] })
  invoiceType: 'S' | 'G' | 'RVR' | 'RTN' | 'RRVR';

  @Column({ type: 'varchar', length: 50 ,unique: true})
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

  @Column({ type: 'decimal', precision: 50, scale: 2 })
  totalWithoutVAT: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 })
  totalVAT: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 })
  grandTotal: number;

  @Column({ type: 'decimal', precision: 50, scale: 4 })
  currencyRate: number;

  @Column({ type: 'decimal', precision: 20, scale: 4 })
  vatPercentage: number;

  @OneToMany(() => InvoiceItem, (item) => item.invoice)
  items: InvoiceItem[];




  @ManyToOne(() => SqmPiece, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sqmPieceId' })
  sqmPiece?: SqmPiece | null;

  @Column({ nullable: true })
  sqmPieceId?: number | null;

   @ManyToOne(() => Invoice, (inv) => inv.returnInvoices, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'returnOfInvoiceId' })
  returnOfInvoice?: Invoice | null;

  @OneToMany(() => Invoice, (inv) => inv.returnOfInvoice)
  returnInvoices?: Invoice[];

  @Column({ type: 'int', nullable: true })
  returnOfInvoiceId?: number | null;



}
