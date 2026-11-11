import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

export const COMPANY_COUNTRIES = ["Lebanon", "Syria"] as const;

@Entity("Company")
export class Company {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 50 })
  companyName: string;

  @Column({ type: "boolean", default: false })
  isActive: boolean;

  @Column({ type: "boolean", default: false })  // ← ADD THIS
  vatInclusive: boolean;

  @Column({ type: "int", default: 0 })
  apiDelayMs: number;

  // Which country's ports vessel tracking treats as "arrived" (see
  // PORTS_BY_COUNTRY in purchase-invoice.service.ts). One of COMPANY_COUNTRIES.
  @Column({ type: "varchar", length: 30, default: "Lebanon" })
  country: string;
}