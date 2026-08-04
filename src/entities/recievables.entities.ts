import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { JournalVoucher } from './Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from './Vouchers/journalVoucherDetails.entity';
import { Invoice } from "./invoice.entity";
import { AlternativeCustomer } from './alternative-customer.entity';

@Entity('receipt_entries')
export class ReceiptEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column()
  customerId: number;

  @ManyToOne(() => AlternativeCustomer, { nullable: true })
  @JoinColumn({ name: 'alternativeCustomerId' })
  alternativeCustomer?: AlternativeCustomer | null;

  @Column({ type: 'int', nullable: true })
  alternativeCustomerId: number | null;

  @Column({ type: 'varchar', length: 3 })
  type: string;

  @Column({ type: 'date' })
  date: Date;

  @ManyToOne(() => Invoice, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "invoiceId" })
  invoice?: Invoice | null;

  @Column({ type: "int", nullable: true })
  invoiceId: number | null;
  @Column({ type: 'decimal', precision: 20, scale: 2 })
  cashNumber: number;

  @Column({ type: 'varchar', length: 3 })
  currency: 'USD' | 'LL';

  @Column({ type: 'decimal', precision: 20, scale: 4, nullable: true })
  exchangeRate: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  amountExchanged: number;

  @Column({ type: 'text', nullable: true })
  comments: string;

  @Column({ type: 'varchar', length: 20, nullable: true})
  pmtType: string;

  // Link to the parent Journal Voucher
  @ManyToOne(() => JournalVoucher, (jv) => jv.receiptEntries, {
    nullable: false,
  })
  @JoinColumn({ name: 'journalVoucherId' })
  journalVoucher: JournalVoucher;

  @Column()
  journalVoucherId: number;

  @CreateDateColumn()
  createdAt: Date;
}
