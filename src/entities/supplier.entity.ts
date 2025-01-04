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

  @ManyToOne(() => Currency, { nullable: false })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @Column({ type: 'boolean', default: true })
  accessible: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  financialNumber: string;

  @Column({ type: 'enum', enum: ['S', 'G'], default: 'S' })
  invoiceType: 'S' | 'G';

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  vat: number;

  @ManyToOne(() => Account, { nullable: false })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @OneToMany(
    () => PaymentVoucher,
    (paymentVoucher) => paymentVoucher.supplier,
    {
      cascade: true,
    },
  )
  paymentVouchers: PaymentVoucher[];
}
