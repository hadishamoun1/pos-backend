import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { JournalVoucher } from './journalVoucher.entity';

@Entity('journal_voucher_details')
export class JournalVoucherDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'accountId', type: 'int' })
  accountId: number;

  @ManyToOne(() => Account, { nullable: false })
  @JoinColumn({ name: 'accountId' })
  account: Account;
  
  @Column({ type: 'varchar', nullable: true, name: 'check' })
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

  @Column({ type: 'varchar', length: 255, nullable: true })
  currency: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  exRateEUROToUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  exRateUSD: number;

  @Column({ type: 'varchar', nullable: true })
  docNbr: string;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @ManyToOne(() => JournalVoucher, (journalVoucher) => journalVoucher.details)
  journalVoucher: JournalVoucher;
}
