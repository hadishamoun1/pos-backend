import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { Customer } from './customer.entity';
import { Supplier } from './supplier.entity';

@Entity('purchase_invoice_settings')
export class PurchaseInvoiceSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  chargeName: string;

  @Column({ type: 'enum', enum: ['amount', 'percentage'] })
  type: 'amount' | 'percentage';

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'int', nullable: true })
  accountId: number;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer?: Customer;

  @Column({ type: 'int', nullable: true })
  customerId?: number;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;

  @Column({ type: 'int', nullable: true })
  supplierId?: number;

  @Column({ type: 'boolean', default: false })
  atc: boolean;

  @Column({ type: 'boolean', default: false })
  shipping: boolean;

  @Column({ type: 'float', default: 0 })
  value: number;

  @Column({ type: 'float', default: 0 })
  valueEx: number;

  @Column({ type: 'enum', enum: ['USD', 'LL'] })
  currency: 'USD' | 'LL';

  @Column({ type: 'float', default: 1.0 })
  exchangeRate: number;
}
