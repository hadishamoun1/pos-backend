import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';
  import { Account } from '../account.entity';
  import { CurrencyRate } from '../currencyRate.entity';
  import { ReceiptVoucher } from './recieptVoucher.entity';
  
  @Entity('receipt_voucher_details')
  export class ReceiptVoucherDetail {
    @PrimaryGeneratedColumn()
    id: number;
  
    @ManyToOne(() => ReceiptVoucher, (voucher) => voucher.details, {
      onDelete: 'CASCADE',
    })
    receiptVoucher: ReceiptVoucher;
  
    @ManyToOne(() => Account, { nullable: false })
    account: Account;
  
    @Column({ type: 'varchar', length: 50 })
    check: string;
  
    @Column({ type: 'date', nullable: true })
    checkDate: Date;
  
    @Column({ type: 'varchar', length: 100 })
    bankName: string;
  
    @Column({ type: 'text', nullable: true })
    description: string;
  
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    dr: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    drUSD: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    drLL: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    cr: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    crUSD: number;
  
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    crLL: number;
  
    @ManyToOne(() => CurrencyRate, { nullable: false })
    exchangeRateAcc: CurrencyRate; // Exchange rate for the account's currency
  
    @ManyToOne(() => CurrencyRate, { nullable: false })
    exchangeRateUSD: CurrencyRate; // Exchange rate for USD
  }
  