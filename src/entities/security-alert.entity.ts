import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

@Entity("security_alert")
export class SecurityAlert {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "is_active", type: "boolean", default: false })
  isActive: boolean;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}