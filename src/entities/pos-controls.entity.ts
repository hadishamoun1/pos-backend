import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

@Entity("pos_controls")
export class PosControls {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "block_creation", type: "boolean", default: false })
  blockCreation: boolean;

  @Column({ name: "block_viewing", type: "boolean", default: false })
  blockViewing: boolean;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
