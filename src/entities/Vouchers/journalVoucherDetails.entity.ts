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
import { Supplier } from '../supplier.entity';
import { Customer } from '../customer.entity';

@Entity('journal_voucher_details')
export class JournalVoucherDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'accountId', type: 'int', nullable: true })
  accountId: number;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ name: 'supplierId', type: 'int', nullable: true })
  supplierId: number;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ name: 'customerId', type: 'int', nullable: true })
  customerId: number;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ type: 'varchar', nullable: true, name: 'check' })
  check: string;

  @Column({ type: 'date', nullable: true })
  checkDate: Date;

  @Column({ type: 'varchar', nullable: true })
  bankName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  dr: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  drUSD: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  drLL: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0,
  })
  drOFR: number;
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0,
  })
  drUSDOFR: number;
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0,
  })
  drLLOFR: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  cr: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  crUSD: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  crLL: number;
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0,
  })
  crOFR: number;
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0,
  })
  crUSDOFR: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0,
  })
  crLLOFR: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  currency: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  exRateEUROToUSD: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  exRateUSD: number;

  @Column({ type: 'varchar', nullable: true })
  docNbr: string;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @ManyToOne(() => JournalVoucher, (jv) => jv.details, { nullable: true })
  @JoinColumn({ name: 'journalVoucherId' })
  journalVoucher: JournalVoucher;
  @Column({ nullable: true })
  journalVoucherId: number;
}
