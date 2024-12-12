import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
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

  @Column({ type: 'varchar', length: 50, nullable: true })
  parentNumber: string;

  @ManyToOne(() => Account, (account) => account.children, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'parentNumber', referencedColumnName: 'accountNumber' })
  parent: Account;

  @OneToMany(() => Account, (account) => account.parent)
  children: Account[];

  // Foreign key to Currency table
  @ManyToOne(() => Currency, (currency) => currency.id, { nullable: true })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  // Accessible column
  @Column({ type: 'boolean', default: true })
  accessible: boolean;
}
