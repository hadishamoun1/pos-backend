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

@Entity('receipt_entries')
export class ReceiptEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column()
  customerId: number;

  @Column({ type: 'varchar', length: 3 })
  type: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceId: string;

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
