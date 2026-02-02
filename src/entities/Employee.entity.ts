// src/employees/entities/employee.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100 })
  nationality: string;

  @Column({ length: 255, nullable: true })
  position: string;

  @Column({ length: 50, nullable: true })
  phone: string;

  // Passport Information
  @Column({ name: 'passport_number', length: 100, nullable: true })
  passportNumber: string;

  @Column({ name: 'passport_issue_date', type: 'date', nullable: true })
  passportIssueDate: Date;

  @Column({ name: 'passport_expiry_date', type: 'date' })
  passportExpiryDate: Date;

  // Work Permit (Iqama) Information
  @Column({ name: 'iqama_number', length: 100, nullable: true })
  iqamaNumber: string;

  @Column({ name: 'iqama_issue_date', type: 'date', nullable: true })
  iqamaIssueDate: Date;

  @Column({ name: 'iqama_expiry_date', type: 'date' })
  iqamaExpiryDate: Date;

  // Files stored as JSON array
  @Column({ type: 'json', nullable: true })
  files: Array<{ name: string; type: string; url?: string }>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}