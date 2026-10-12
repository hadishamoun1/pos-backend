import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// A cost (typically customs clearance) that actually covers several
// purchase invoices at once — e.g. two orders that arrived on the same
// vessel and were cleared through customs together under one bill. Each
// invoice's computed share is written as a normal charge row on that
// invoice (see SharedChargeAllocation.unitPriceRowId); this header + its
// allocations just keep a record of which invoices were split together and
// how, so it can be traced back later.
@Entity('shared_charges')
export class SharedCharge {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  totalAmount: number;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  // 'value' | 'sqm' | 'equal'
  @Column({ type: 'varchar', length: 20 })
  allocationMethod: string;

  @CreateDateColumn()
  createdAt: Date;
}
