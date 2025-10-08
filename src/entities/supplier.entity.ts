import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Account } from './account.entity';
import { Currency } from './currency.entity';
import { PaymentVoucher } from './Vouchers/paymentVoucher.entity';

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  supplierAccountNumber: string;

  @Column({ type: 'varchar', length: 255 })
  supplierName: string;

  // NEW: optional structured name fields
  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  middleName?: string;

  // NEW: area / description / company type / payment terms
  @Column({ type: 'varchar', length: 120, nullable: true })
  area?: string;



  @Column({ type: 'text', nullable: true })
  companyType?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  paymentTerms?: string;

  @ManyToOne(() => Currency, { nullable: false })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;


  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  financialNumber: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  vat: number;

  @ManyToOne(() => Account, { nullable: false })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @OneToMany(
    () => PaymentVoucher,
    (paymentVoucher) => paymentVoucher.supplier,
    { cascade: true },
  )
  paymentVouchers: PaymentVoucher[];
}
