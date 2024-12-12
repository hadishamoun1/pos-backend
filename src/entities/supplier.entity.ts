import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';
  import { Account } from './account.entity';
  
  @Entity('suppliers')
  export class Supplier {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({ type: 'varchar', length: 50, unique: true })
    supplierAccountNumber: string;
  
    @Column({ type: 'varchar', length: 255 })
    supplierName: string;
  
    @Column({ type: 'int' })
    currencyId: number;
  
    @Column({ type: 'boolean', default: true })
    accessible: boolean;
  
    @Column({ type: 'varchar', length: 255, nullable: true })
    address: string;
  
    @Column({ type: 'varchar', length: 255, nullable: true })
    location: string;
  
    @Column({ type: 'varchar', length: 20, nullable: true })
    phoneNumber: string;
  
    @Column({ type: 'varchar', length: 50, nullable: true })
    financialAccount: string;
  
    @Column({ type: 'enum', enum: ['S', 'G'], default: 'S' })
    invoiceType: 'S' | 'G';
  
    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    vat: number;
  
    @ManyToOne(() => Account, { nullable: false })
    @JoinColumn({ name: 'accountId' })
    account: Account;
  }
  