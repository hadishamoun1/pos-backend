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
import { ReceiptVoucherDetail } from './recieptVoucherDetails.entity';

@Entity('receipt_vouchers')
export class ReceiptVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: Date;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: 'customerAccountId' }) // Foreign key for Customer
  customer: Customer;

  @Column({ type: 'varchar', length: 50, unique: true })
  rvNumber: string; // Incremental RV number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalDr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalDrUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalDrLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalCr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalCrUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalCrLL: number;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @OneToMany(() => ReceiptVoucherDetail, (detail) => detail.receiptVoucher, {
    cascade: true,
  })
  details: ReceiptVoucherDetail[];
}
