// src/entities/company.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("Company")
export class Company {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 50 })
  companyName: string;

  @Column({ type: "boolean", default: false })
  isActive: boolean;
}