import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SharedCharge } from './shared-charge.entity';
import { PurchaseInvoice } from './purchase-invoice.entity';
import { UnitPriceModalRow } from './unit-price-modal-row.entity';

// One invoice's computed share of a SharedCharge — points at the actual
// UnitPriceModalRow that carries the amount on that invoice, so the split
// can be traced (or the row identified) later even though the row itself
// looks like any other manually-entered charge.
@Entity('shared_charge_allocations')
export class SharedChargeAllocation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SharedCharge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sharedChargeId' })
  sharedCharge: SharedCharge;

  @Column()
  sharedChargeId: number;

  @ManyToOne(() => PurchaseInvoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchaseInvoiceId' })
  purchaseInvoice: PurchaseInvoice;

  @Column()
  purchaseInvoiceId: number;

  @ManyToOne(() => UnitPriceModalRow, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unitPriceRowId' })
  unitPriceRow: UnitPriceModalRow | null;

  @Column({ type: 'int', nullable: true })
  unitPriceRowId: number | null;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  allocatedAmount: number;

  // The raw weight used for this invoice (grand amount, total SQM, or 1 for
  // an equal split) — kept for transparency on how the share was computed.
  @Column({ type: 'decimal', precision: 20, scale: 4 })
  weight: number;
}
