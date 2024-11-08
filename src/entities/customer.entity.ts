import { Entity, Column, PrimaryGeneratedColumn ,OneToMany} from 'typeorm';
import { Invoice } from './invoice.entity';
@Entity()
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column()
  phoneNumber: string;

  @Column({ unique: true, nullable: true })
  financialNumber: string;

  @Column()
  address: string;

  @Column('simple-array') // Allows storing 'S,G' for both types
  invoiceType: string[];

  @Column()
  companyName: string;

  @Column({ nullable: true })
  location: string;

  @OneToMany(() => Invoice, (invoice) => invoice.customer)
  invoices: Invoice[]; // One-to-many relationship with Invoice
}
