import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Currency } from './currency.entity';
import { Account } from './account.entity';
import { Invoice } from './invoice.entity';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  customerAccountNumber: string;

  @Column({ type: 'varchar', length: 255 })
  customerName: string;

  @Column({ type: 'boolean', default: true })
  accessible: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phoneNumber?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  financialNumber?: string;

  @Column({ type: 'enum', enum: ['S', 'G'], nullable: true })
  invoiceType?: 'S' | 'G';

  @Column({ type: 'decimal', nullable: true })
  vat?: number;

  // Explicitly define the foreign key for currency
  @Column({ type: 'int' })
  currencyId: number;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @ManyToOne(() => Account, (account) => account.children, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @OneToMany(() => Invoice, (invoice) => invoice.customer)
  invoices: Invoice[];
  @OneToMany(() => Request, (request) => request.customer)
  requests: Request[];
}
