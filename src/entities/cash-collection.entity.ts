// src/entities/cash-collection.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity";       // adjust path
import { Customer } from "./customer.entity"; // adjust path
import { Currency } from "./currency.entity"; // adjust path (optional)

export type CashCollectionMethod = "CASH" | "WHISH" | "CHEQUE" | "OTHER";

@Entity({ name: "cash_collections" })
export class CashCollection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "date" })
  @Index()
  date: string;

  @Column()
  @Index()
  customerId: number;

  @ManyToOne(() => Customer, { eager: true, nullable: false })
  @JoinColumn({ name: "customerId" })
  customer: Customer;

  @Column({ type: "varchar", length: 120, nullable: true })
  driverName: string | null;

  @Column()
  @Index()
  employeeId: number;

  @ManyToOne(() => User, { eager: true, nullable: false })
  @JoinColumn({ name: "employeeId" })
  employee: User;

  @Column({ type: "decimal", precision: 18, scale: 2 })
  amount: string;

  @Column({ nullable: true })
  @Index()
  currencyId?: number;

  @ManyToOne(() => Currency, { eager: true, nullable: true })
  @JoinColumn({ name: "currencyId" })
  currency?: Currency;

  @Column({ type: "varchar", length: 20, default: "CASH" })
  method: CashCollectionMethod;

  @Column({ type: "varchar", length: 100, nullable: true })
  reference?: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  notes?: string;

  @Column({ type: "boolean", default: false })
  isPosted: boolean;

  // ✅ NEW: link to ReceiptEntry (recievables) so we can avoid duplicates
  @Column({ type: "int", nullable: true })
  @Index()
  receivableEntryId?: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
