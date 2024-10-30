import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

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

  @Column("simple-array") // Allows storing 'S,G' for both types
  invoiceType: string[];  

  @Column()
  companyName: string;

  @Column({ nullable: true })
  location: string;
}
