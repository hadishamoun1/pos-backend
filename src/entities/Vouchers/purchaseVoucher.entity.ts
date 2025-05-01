// src/entities/Vouchers/purchaseVoucher.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Supplier } from '../supplier.entity';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { PurchaseVoucherDetail } from './purchaseVoucherDetails.entity';
import { PurchaseInvoice } from '../Purchase-Invoice/purchase-invoice.entity';

@Entity('purchase_vouchers')
export class PurchaseVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  // ← this is the FK to PurchaseInvoice
  @ManyToOne(() => PurchaseInvoice, (inv) => inv.vouchers, { nullable: true })
  @JoinColumn({ name: 'purchaseInvoiceId' })
  purchaseInvoice: PurchaseInvoice;

  @Column({ type: 'int', nullable: true })
  purchaseInvoiceId: number;

  // ← this is the FK to Supplier
  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ type: 'int', nullable: true })
  supplierId: number;

  @Column({ type: 'date' })
  date: Date;

  // ← this is the FK to Account
  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'int', nullable: true })
  accountId: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  pvNumber: string;

  // your totalDr / totalCr columns…
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

  // ← FK to CurrencyRate for account‐currency
  @ManyToOne(() => CurrencyRate, { nullable: true })
  @JoinColumn({ name: 'exchangeRateAccId' })
  exchangeRateAcc: CurrencyRate;

  @Column({ type: 'int', nullable: true })
  exchangeRateAccId: number;

  // ← FK to CurrencyRate for USD‐conversion
  @ManyToOne(() => CurrencyRate, { nullable: true })
  @JoinColumn({ name: 'exchangeRateUSDId' })
  exchangeRateUSD: CurrencyRate;

  @Column({ type: 'int', nullable: true })
  exchangeRateUSDId: number;

  // ← one‐to‐many into the details table
  @OneToMany(() => PurchaseVoucherDetail, (d) => d.purchaseVoucher, {
    cascade: true,
  })
  details: PurchaseVoucherDetail[];
}
