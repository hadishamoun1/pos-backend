import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { PaymentVoucher } from './paymentVoucher.entity';

@Entity('payment_voucher_details')
export class PaymentVoucherDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PaymentVoucher, (paymentVoucher) => paymentVoucher.details, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'paymentVoucherId' }) // Link details to payment voucher
  paymentVoucher: PaymentVoucher;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' }) // Link to specific account
  account: Account;

  @Column({ type: 'varchar', nullable: true })
  check: string;

  @Column({ type: 'date', nullable: true })
  checkDate: Date;

  @Column({ type: 'varchar', nullable: true })
  bankName: string;

  @Column({ type: 'varchar', nullable: true })
  checkNumber: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  dr: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  drUSD: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  drLL: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  cr: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  crUSD: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  crLL: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  exchangeRate: number;
}
