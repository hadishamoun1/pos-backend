import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Request } from './request.entity';
import { Dimension } from './inventory/dimension.entity';

@Entity()
export class RequestItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Request, (request) => request.requestItems)
  @JoinColumn({ name: 'requestId' })
  request: Request; // Reference to the associated request

  @ManyToOne(() => Dimension, { eager: true })
  @JoinColumn({ name: 'dimensionId' })
  dimension: Dimension; // Reference to the specific item dimension in the inventory

  @Column()
  quantity: number; // Quantity of the item being requested (in boxes or sheets)

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  sqm: number; // Calculated square meters based on dimensions and quantity

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  pricePerUnit: number; // Price per unit of the item

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalPriceUSD: number; // Total price in USD for this item (sqm * pricePerUnit)

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  vatUSD: number; // VAT amount in USD

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalPriceUSDWithVAT: number; // Total price including VAT
}
