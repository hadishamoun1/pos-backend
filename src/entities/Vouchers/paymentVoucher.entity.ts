import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
  } from 'typeorm';
  import { Account } from '../account.entity';
  import { CurrencyRate } from '../currencyRate.entity';
  import { PaymentVoucherDetail } from './paymentVoucherDetails.entity';
  
  @Entity('payment_vouchers')
  export class PaymentVoucher {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({ type: 'date' })
    date: Date;
  
    @ManyToOne(() => Account, { nullable: false })
    account: Account;
  
    @Column({ type: 'varchar', length: 50, unique: true })
    pmNumber: string;
  
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
  
    @OneToMany(() => PaymentVoucherDetail, (detail) => detail.paymentVoucher, {
      cascade: true,
    })
    details: PaymentVoucherDetail[];
  }
  