import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
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

  @OneToMany(() => PaymentVoucherDetail, (detail) => detail.paymentVoucher, {
    cascade: true,
  })
  details: PaymentVoucherDetail[];
}
