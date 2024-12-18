import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
  } from 'typeorm';
  import { Account } from '../account.entity';
  import { CurrencyRate } from '../currencyRate.entity';
  import { PurchaseVoucher } from './purchaseVoucher.entity';
  
  @Entity('purchase_voucher_details')
  export class PurchaseVoucherDetail {
    @PrimaryGeneratedColumn()
    id: number;
  
    @ManyToOne(() => Account, { nullable: false })
    account: Account;
  
    @Column({ type: 'varchar', nullable: true })
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
  
    @ManyToOne(() => CurrencyRate, { nullable: false })
    exchangeRateAcc: CurrencyRate;
  
    @ManyToOne(() => CurrencyRate, { nullable: false })
    exchangeRateUSD: CurrencyRate;
  
    @ManyToOne(() => PurchaseVoucher, (purchaseVoucher) => purchaseVoucher.details)
    purchaseVoucher: PurchaseVoucher;
  }
  