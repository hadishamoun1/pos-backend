import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PaymentVoucher } from './paymentVoucher.entity';

export type Currency = 'USD' | 'LL';

@Entity('payment_voucher_details')
export class PaymentVoucherDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 10 })
  currency: Currency;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 1 })
  exchangeRate: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  amountExchanged: number;

  @Column({ type: 'varchar', nullable: true })
  checkNumber: string;

  @Column({ type: 'varchar', nullable: true })
  bankName: string;

  @Column({ type: 'date', nullable: true })
  checkDate: string;

  @Column({ type: 'date', nullable: true })
  checkDueDate: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ nullable: true })
  paymentVoucherId: number;

  @ManyToOne(() => PaymentVoucher, (voucher) => voucher.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentVoucherId' })
  paymentVoucher: PaymentVoucher;
}