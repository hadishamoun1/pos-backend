import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Supplier } from '../supplier.entity';
import { Account } from '../account.entity';
import { PaymentVoucherDetail } from './paymentVoucherDetails.entity';
import { JournalVoucher } from './journalVoucher.entity';

export type PaymentType = 'Cash USD' | 'Cash LL' | 'Check USD' | 'Check LL';
export type VoucherType = 'S' | 'G';

@Entity('payment_vouchers')
export class PaymentVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  paymentNumber: string;

  @Column({ nullable: true })
  supplierId: number;

  @ManyToOne(() => Supplier, (supplier) => supplier.paymentVouchers, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ nullable: true })
  accountId: number;

  @ManyToOne(() => Account, { nullable: true })

  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'varchar', length: 50 })
  paymentType: PaymentType;

  @Column({ type: 'varchar', length: 1 })
  type: VoucherType;

  @Column({ type: 'date', nullable: true })
  date: string;

  @Column({ type: 'varchar', nullable: true })
  invoiceId: string;

  @Column({ type: 'varchar', nullable: true })
  doneBy: string;

  @CreateDateColumn()
  dateCreated: string;

  @UpdateDateColumn()
  dateModified: string;

  @OneToMany(() => PaymentVoucherDetail, (detail) => detail.paymentVoucher, {
    cascade: true,
  })
  details: PaymentVoucherDetail[];

  // FK column stored on payment_vouchers table
  @Column({ nullable: true })
  journalVoucherId: number;

  @OneToOne(() => JournalVoucher, (jv) => jv.paymentVoucher, { nullable: true })
  @JoinColumn({ name: 'journalVoucherId' })
  journalVoucher: JournalVoucher;
}