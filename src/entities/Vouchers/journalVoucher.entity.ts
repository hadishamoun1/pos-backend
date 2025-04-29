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
import { JournalVoucherDetail } from './journalVoucherDetails.entity';

@Entity('journal_vouchers')
export class JournalVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'varchar', length: 50, unique: true })
  jvNumber: string;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalDr: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalDrUSD: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalDrLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrUSDOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrLLOFR: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalCr: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalCrUSD: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalCrLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrUSDOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrLLOFR: number;

  @Column({ type: 'varchar', length: 1 })
  jvType: string;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @Column({ type: 'boolean', default: true })
  ofr: boolean;

  @Column({ type: 'boolean', default: true })
  rvr: boolean;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @OneToMany(() => JournalVoucherDetail, (detail) => detail.journalVoucher, {
    cascade: true,
  })
  details: JournalVoucherDetail[];
}
