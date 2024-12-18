import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Account } from '../account.entity';
import { ReceiptVoucherReturn } from './receiptVoucherReturn.entity';
import { CurrencyRate } from '../currencyRate.entity';

@Entity('receipt_voucher_return_details')
export class ReceiptVoucherReturnDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ReceiptVoucherReturn, (rvr) => rvr.details, {
    nullable: false,
  })
  receiptVoucherReturn: ReceiptVoucherReturn;

  @ManyToOne(() => Account, { nullable: false })
  account: Account;

  @Column({ type: 'varchar', length: 50, nullable: true })
  check: string;

  @Column({ type: 'date', nullable: true })
  checkDate: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  bankName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  dr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  drUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  drLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cr: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  crUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  crLL: number;

  @ManyToOne(() => CurrencyRate, { nullable: false })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: false })
  exchangeRateUSD: CurrencyRate;
}
