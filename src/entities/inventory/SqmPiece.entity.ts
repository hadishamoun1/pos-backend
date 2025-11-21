import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TransferItem } from './transferItem.entity';
import { ItemVariant } from './itemVariant.entity';
import { ItemBatch } from './itemBatch.entity';

@Entity({ name: 'sqm_pieces' })
export class SqmPiece {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The BOSTS transfer line (TransferItem) this piece group comes from.
   * If the transfer line is deleted, these records are deleted as well.
   */
  @ManyToOne(() => TransferItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transferItemId' })
  transferItem: TransferItem;

  @Index()
  @Column()
  transferItemId: number;

  /**
   * The sqm ItemVariant where this area actually lives in stock.
   * (Same variant that BOSTS used for the sqm movement.)
   */
  @ManyToOne(() => ItemVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sqmVariantId' })
  sqmVariant: ItemVariant;

  @Index()
  @Column()
  sqmVariantId: number;

  /**
   * The sqm batch that holds this area (for OFR totals & costing).
   */
  @ManyToOne(() => ItemBatch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sqmBatchId' })
  sqmBatch: ItemBatch;

  @Index()
  @Column()
  sqmBatchId: number;

  /**
   * Geometry of a single piece (cm).
   * Example: length = 80, width = 150.
   */
  @Column('decimal', { precision: 10, scale: 2 })
  length: number;

  @Column('decimal', { precision: 10, scale: 2 })
  width: number;

  /**
   * Number of pieces with this same geometry.
   */
  @Column('int')
  piecesCount: number;

  /**
   * Computed as (length * width / 10_000).
   * Stored for fast reporting (m² of ONE piece).
   */


  /**
   * Total m² represented by this group = piecesCount * sqmPerPiece.
   * This should never exceed the sqm of the source TransferItem.
   */
  @Column('decimal', { precision: 12, scale: 4,default:0 })
  sqmTotal: number;

  /**
   * Remaining m² that can still be sold from this piece group.
   * Initially = sqmTotal. When you start selling from pieces later,
   * you will decrement this.
   */

 @Column('decimal', { precision: 12, scale: 4,default:0 })
  sqmSold: number;

  @Column('decimal', { precision: 12, scale: 4,default:0 })
  sqmRemaining: number;

  /**
   * Soft flag so you can "deactivate" a piece group if needed.
   */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
