import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Currency } from './currency.entity';

@Entity()
export class CurrencyRate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('decimal', { precision: 10, scale: 4 })
  exchangeRate: number; // e.g., 1.5

  @ManyToOne(() => Currency, (currency) => currency.exchangeRates, {
    onDelete: 'CASCADE',
  })
  currency: Currency;
}
