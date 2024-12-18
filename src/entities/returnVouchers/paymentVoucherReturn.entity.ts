import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
  } from 'typeorm';
  import { Account } from '../account.entity';
  import { CurrencyRate } from '../currencyRate.entity';
  import { PaymentVoucherReturnDetail } from './paymentVoucherReturnDetails.entity';
  
  @Entity('payment_voucher_returns')
  export class PaymentVoucherReturn {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({ type: 'date' })
    date: Date;
  
    @ManyToOne(() => Account, { nullable: false })
    account: Account;
  
    @Column({ type: 'varchar', length: 50, unique: true })
    pvrNumber: string;
  
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
  
    @OneToMany(
      () => PaymentVoucherReturnDetail,
      (detail) => detail.paymentVoucherReturn,
      { cascade: true },
    )
    details: PaymentVoucherReturnDetail[];
  }
  