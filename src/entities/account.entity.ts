import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Currency } from './currency.entity';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  accountNumber: string;

  @Column({ type: 'varchar', length: 255 })
  accountName: string;

  // just a normal column now – no relation
  @Column({ type: 'varchar', length: 50, nullable: true })
  parentNumber: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  arabicAccountName: string;

  // Foreign key to Currency table
  @ManyToOne(() => Currency, (currency) => currency.id, { nullable: true })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  // Accessible column
  @Column({ type: 'boolean', default: true })
  accessible: boolean;

  // Optional: if you still want to attach children in memory only
  children?: any[];
}
