import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
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

  @ManyToOne(() => Account, { nullable: false })
  account: Account;

  @Column({ type: 'varchar', length: 50, unique: true })
  jvNumber: string;

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

  @Column({ type: 'varchar', length: 1})
  jvType: string;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @OneToMany(() => JournalVoucherDetail, (detail) => detail.journalVoucher, {
    cascade: true,
  })
  details: JournalVoucherDetail[];
}
