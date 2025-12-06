import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  RelationId,
} from 'typeorm';
import { Request } from './request.entity';
import { ItemVariant } from './inventory/itemVariant.entity';
import { ItemBatch } from './inventory/itemBatch.entity';

@Entity()
export class RequestDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Request, (request) => request.details, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'requestId' })
  request: Request;

  @Column({ type: 'int', default: 1 }) 
  quantity: number;

  @ManyToOne(() => ItemVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant;

@ManyToOne(() => ItemBatch, { nullable: true, onDelete: 'RESTRICT' })
@JoinColumn({ name: 'itemBatchId' })
itemBatch?: ItemBatch;

@Column({ type: 'int', nullable: true, default: null })
itemBatchId?: number | null;



  @Column({ type: 'decimal', precision: 10, scale: 2 })
  sqm: number; // Square meters for this item in the request

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number; // Price per sqm

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number; // Total price (sqm * price)
}
