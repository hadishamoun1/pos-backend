import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { PurchaseVoucher } from './purchaseVoucher.entity';
import { Supplier } from '../supplier.entity';

@Entity('purchase_voucher_details')
export class PurchaseVoucherDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Account, { nullable: true })
  account: Account;

  @Column({ type: 'varchar', nullable: true })
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

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @ManyToOne(
    () => PurchaseVoucher,
    (purchaseVoucher) => purchaseVoucher.details,
  )
  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ type: 'int', nullable: true })
  supplierId: number;
  
  purchaseVoucher: PurchaseVoucher;
}
