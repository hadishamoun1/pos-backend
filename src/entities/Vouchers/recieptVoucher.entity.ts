import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { ReceiptVoucherDetail } from './recieptVoucherDetails.entity';

@Entity('receipt_vouchers')
export class ReceiptVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: Date;

  @ManyToOne(() => Account, { nullable: false })
  account: Account;

  @Column({ type: 'varchar', length: 50, unique: true })
  rvNumber: string; // Incremental RV number

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrLL: number;

  @ManyToOne(() => CurrencyRate, { nullable: false })
  exchangeRateAcc: CurrencyRate; // Exchange rate for the account's currency

  @ManyToOne(() => CurrencyRate, { nullable: false })
  exchangeRateUSD: CurrencyRate; // Exchange rate for USD

  @OneToMany(() => ReceiptVoucherDetail, (detail) => detail.receiptVoucher, {
    cascade: true,
  })
  details: ReceiptVoucherDetail[];
}
