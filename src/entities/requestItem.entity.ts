import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Request } from './request.entity';
import { Inventory } from './inventory.entity';

@Entity()
export class RequestItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Request, (request) => request.requestItems)
  @JoinColumn({ name: 'requestId' })
  request: Request;

  @ManyToOne(() => Inventory, { eager: true })
  @JoinColumn({ name: 'inventoryId' })
  inventory: Inventory;

  @Column()
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  sqm: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  pricePerUnit: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalPriceUSD: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  vatUSD: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalPriceUSDWithVAT: number;
}
