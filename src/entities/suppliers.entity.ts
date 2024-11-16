import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { PurchaseInvoice } from './purchaseInvoice.entity';
import { IsString, IsNotEmpty } from 'class-validator';

@Entity()
@Unique(['name'])
export class Supplier {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @IsString()
  @IsNotEmpty()
  name: string; // Supplier's name

  @Column()
  @IsString()
  @IsNotEmpty()
  contactInfo: string; // Contact information for the supplier

  @Column({ nullable: true, default: 'Not provided' })
  @IsString()
  address: string; // Optional address for the supplier

  @OneToMany(() => PurchaseInvoice, (purchaseInvoice) => purchaseInvoice.supplierName)
  purchaseInvoices: PurchaseInvoice[]; // Link to purchase invoices

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
