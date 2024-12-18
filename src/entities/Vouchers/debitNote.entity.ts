import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { DebitNoteDetail } from './debitNoteDetails.entity';

@Entity('debit_note')
export class DebitNote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: Date;

  @ManyToOne(() => Account, { nullable: false })
  account: Account;

  @Column({ type: 'varchar', length: 50, unique: true })
  dnNumber: string;

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
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: false })
  exchangeRateUSD: CurrencyRate;

  @OneToMany(() => DebitNoteDetail, (detail) => detail.debitNote, {
    cascade: true,
  })
  details: DebitNoteDetail[];
}
