// src/entities/user.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 50 })
  username: string;

  @Column({ type: "varchar", length: 255 })
  passwordHash: string;

  // Role name (simple)
  @Column({ type: "varchar", length: 30, default: "USER" })
  role: string;

  // Fine-grained permissions (this is what controls buttons like delete)
  @Column({ type: "simple-json", nullable: true })
  permissions: string[]; // e.g. ["items.delete", "items.update"]
  
  @Column({ type: "int", default: 1 })
  tokenVersion: number;

  // ✅ NEW: Language preference
  @Column({ type: "varchar", length: 2, default: "en" })
  language: string; // 'en' or 'ar'
}