import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

@Entity("pos_controls")
export class PosControls {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "block_creation", type: "boolean", default: false })
  blockCreation: boolean;

  @Column({ name: "block_viewing", type: "boolean", default: false })
  blockViewing: boolean;

  // Hide Edit on invoices, receivables and journal vouchers dated 2+ days ago.
  @Column({ name: "lock_old_edits", type: "boolean", default: false })
  lockOldEdits: boolean;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
