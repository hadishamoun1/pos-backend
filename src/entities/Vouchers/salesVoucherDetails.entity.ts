import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { SalesVoucher } from './salesVoucher.entity';
import { Customer } from '../customer.entity';

@Entity('sales_voucher_details')
export class SalesVoucherDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Account, { nullable: false })
  account: Account;

  @Column({ type: 'varchar', nullable: true })
  check: string;

  @Column({ type: 'date', nullable: true })
  checkDate: Date;

  @Column({ type: 'varchar', nullable: true })
  bankName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  dr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  drUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  drLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  cr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  crUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  crLL: number;

  @ManyToOne(() => CurrencyRate, { nullable: false })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: false })
  exchangeRateUSD: CurrencyRate;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @ManyToOne(() => SalesVoucher, (salesVoucher) => salesVoucher.details)
  salesVoucher: SalesVoucher;
}
