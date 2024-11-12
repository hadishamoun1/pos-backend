// supplier.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { PurchaseInvoice } from './purchaseInvoice.entity';

@Entity()
export class Supplier {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string; // Supplier's name

  @Column()
  contactInfo: string; // Contact information for the supplier

  @Column({ nullable: true })
  address: string; // Optional address for the supplier

  @OneToMany(() => PurchaseInvoice, (purchaseInvoice) => purchaseInvoice.supplier)
  purchaseInvoices: PurchaseInvoice[]; // Link to purchase invoices
}
