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
import { PurchaseVoucherDetail } from './purchaseVoucherDetails.entity';
import { Supplier } from '../supplier.entity';

@Entity('purchase_vouchers')
export class PurchaseVoucher {
  @PrimaryGeneratedColumn()
  id: number;
  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ type: 'int', nullable: true })
  supplierId: number;

  @Column({ type: 'date' })
  date: Date;

  @ManyToOne(() => Account, { nullable: true })
  account: Account;

  @Column({ type: 'varchar', length: 50, unique: true })
  pvNumber: string; // Purchase Voucher Number (e.g., PV - 1)

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrUSDOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDrLLOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrUSDOFR: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalCrLLOFR: number;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @OneToMany(() => PurchaseVoucherDetail, (detail) => detail.purchaseVoucher, {
    cascade: true,
  })
  details: PurchaseVoucherDetail[];
}
