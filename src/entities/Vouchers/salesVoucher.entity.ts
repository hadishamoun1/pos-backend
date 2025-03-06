import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { SalesVoucherDetail } from './salesVoucherDetails.entity';
import { Invoice } from '../invoice.entity';

@Entity('sales_vouchers')
export class SalesVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'varchar', length: 50, unique: true })
  svNumber: string; // Sales Voucher Number (e.g., SV - 1)

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  totalDr: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  totalDrUSD: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  totalDrLL: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  totalCr: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  totalCrUSD: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  totalCrLL: number;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @OneToMany(() => SalesVoucherDetail, (detail) => detail.salesVoucher, {
    cascade: true,
  })
  @ManyToOne(() => Invoice, (invoice) => invoice.salesVouchers, {
    nullable: true,
  })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;
  details: SalesVoucherDetail[];
}
