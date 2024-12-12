import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { CurrencyRate } from './currencyRate.entity';

@Entity()
export class Currency {
  @PrimaryGeneratedColumn()
  id: number;
  @Column({ length: 3 })
  currencyCode: string; // e.g., LL, $

  @Column({ length: 50 })
  currencyName: string; // e.g., Lebanese Pound, US Dollar

  @OneToMany(() => CurrencyRate, (rate) => rate.currency)
  exchangeRates: CurrencyRate[];
}
