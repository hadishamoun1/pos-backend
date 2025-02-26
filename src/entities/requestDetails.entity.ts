import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Request } from './request.entity';
import { ItemVariant } from './inventory/itemVariant.entity';

@Entity()
export class RequestDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Request, (request) => request.details, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'requestId' })
  request: Request;

  @ManyToOne(() => ItemVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  sqm: number; // Square meters for this item in the request

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number; // Price per sqm

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number; // Total price (sqm * price)
}
