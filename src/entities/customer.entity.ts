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

  @Column({ unique: true })
  financialNumber: string;

  @Column()
  address: string;

  @Column()
  invoiceType: string; // Should be either 'S' or 'G'

  @Column()
  companyName: string;

  @Column()
  location: string;
}
