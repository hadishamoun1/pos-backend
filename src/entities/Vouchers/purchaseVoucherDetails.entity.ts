// src/entities/Vouchers/purchaseVoucherDetails.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PurchaseVoucher } from './purchaseVoucher.entity';
import { Account } from '../account.entity';
import { Supplier } from '../supplier.entity';
import { CurrencyRate } from '../currencyRate.entity';

@Entity('purchase_voucher_details')
export class PurchaseVoucherDetail {
  @PrimaryGeneratedColumn()
  id: number;

  // ← FK back up to the voucher
  @ManyToOne(() => PurchaseVoucher, (v) => v.details, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'purchaseVoucherId' })
  purchaseVoucher: PurchaseVoucher;

  @Column({ type: 'int' })
  purchaseVoucherId: number;

  // ← optional “expense” account on this detail
  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'int', nullable: true })
  accountId: number;

  // ← optional supplier override
  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ type: 'int', nullable: true })
  supplierId: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  dr: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  drUSD: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  drLL: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  drOFR: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  drUSDOFR: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  drLLOFR: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  cr: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  crUSD: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  crLL: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  crOFR: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  crUSDOFR: number;
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  crLLOFR: number;

  // ← optional currency‐rate reference on the detail
  @ManyToOne(() => CurrencyRate, { nullable: true })
  @JoinColumn({ name: 'exchangeRateAccId' })
  exchangeRateAcc: CurrencyRate;

  @Column({ type: 'int', nullable: true })
  exchangeRateAccId: number;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  @JoinColumn({ name: 'exchangeRateUSDId' })
  exchangeRateUSD: CurrencyRate;

  @Column({ type: 'int', nullable: true })
  exchangeRateUSDId: number;
}
