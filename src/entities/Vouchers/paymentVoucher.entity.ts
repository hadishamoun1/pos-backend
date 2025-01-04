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
import { Customer } from '../customer.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { PaymentVoucherDetail } from './paymentVoucherDetails.entity';

@Entity('payment_vouchers')
export class PaymentVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: Date;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: 'customerId' }) // Link customer to payment voucher
  customer: Customer;

  @Column({ type: 'varchar', length: 50, unique: true })
  pmNumber: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  totalDr: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  totalDrUSD: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  totalDrLL: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  totalCr: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  totalCrUSD: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  totalCrLL: number;

  @Column({ type: 'varchar', nullable: true })
  paymentType: string;

  @Column({ type: 'varchar', nullable: true })
  type: string;

  @CreateDateColumn({ type: 'timestamp' })
  dateCreated: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  dateModified: Date;

  @Column({ type: 'varchar', nullable: true })
  doneBy: string;

  @Column({ type: 'varchar', length: 50 })
  invoiceId: string;

  @OneToMany(() => PaymentVoucherDetail, (detail) => detail.paymentVoucher, {
    cascade: true,
  })
  details: PaymentVoucherDetail[];
}
