import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Customer } from './customer.entity';
import { RequestItem } from './request-item.entity';

@Entity()
export class Request {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, (customer) => customer.id, { eager: true })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  exchangeRate: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalAmountUSDWithVAT: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalAmountUSDWithoutVAT: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalVATLBP: number;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  requestedAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @OneToMany(() => RequestItem, (requestItem) => requestItem.request, { cascade: true })
  requestItems: RequestItem[];
}
