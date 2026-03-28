import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity'; // Import the ItemVariant entity
import { ItemBatch } from './inventory/itemBatch.entity';
import { SqmPiece } from './inventory/SqmPiece.entity';

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn()
  id: number;


// invoiceItem.entity.ts
  @ManyToOne(() => Invoice, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;

  @Column({ name: 'invoiceId', nullable: false })  // 👈 explicit
  invoiceId: number;

  // 🔽 New Foreign Key to Link Item Variants
  @ManyToOne(() => ItemVariant)
  @JoinColumn({ name: 'itemVariantId' })
  itemVariant: ItemVariant;

  @Column({ nullable: true })
  itemVariantId: number;

  @ManyToOne(() => ItemBatch, { eager: true })
  @JoinColumn({ name: 'itemBatchId' })
  itemBatch: ItemBatch;

  @Column({ nullable: true })
  itemBatchId: number;

  @ManyToOne(() => SqmPiece, { nullable: true })
  @JoinColumn({ name: 'sqmPieceId' })
  sqmPiece: SqmPiece | null;

  @Column({ name: 'sqmPieceId', type: 'int', nullable: true })
  sqmPieceId: number | null;



    @Column('decimal', { precision: 10, scale: 2, nullable: true })
  length: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  width: number | null;

    @Column({ type: 'int', nullable: true })
  sheetsPerBox: number | null;

  // Keep only necessary fields (remove duplicate item info)
  @Column({ type: 'decimal', precision: 50, scale: 2 })
  sqm: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 })
  totalAmount: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 })
  vat: number;
  @Column({ type: 'int', default: 1 })
  quantity: number;

  // ─── New cost tracking columns ────────────────────

  /** Weighted average cost */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  averageCost: number;

  /** Weighted average cost in C currency */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  averageCostC: number;

  /** Weighted average cost VM */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  averageCostVM: number;

  /** Weighted average cost CVM */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  averageCostCVM: number;

  /** Most recent unit cost */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  lastCost: number;

  /** Most recent unit cost in C currency */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  lastCostC: number;

  /** Most recent unit cost VM */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  lastCostVM: number;

  /** Most recent unit cost CVM */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  lastCostCVM: number;

  @Column({ type: 'boolean', default: false })
sqmCutResolved: boolean;
}
