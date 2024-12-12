import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity()
export class Branch {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  branchName: string;
  @OneToMany(() => Invoice, (invoice) => invoice.branch)
  invoices: Invoice[];
}
