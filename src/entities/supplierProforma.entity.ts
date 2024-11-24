import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Supplier } from './suppliers.entity';
import { SupplierProformaItem } from './supplierProformaItem.entity';

@Entity('supplier_proformas')
export class SupplierProforma {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Supplier, (supplier) => supplier.proformas, {
    eager: true,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @Column({ type: 'varchar', unique: true })
  proformaNumber: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  invoiceAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  shippingCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalInvoiceAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  customs: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 ,nullable:(true)})
  customsLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2,nullable:(true) })
  customsExchangeRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  tva: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 ,nullable:(true)})
  tvaLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  fio: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  fioTva: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  transport: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  transportTva: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  transferFees: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalFees: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalTva: number;

  @OneToMany(() => SupplierProformaItem, (item) => item.proforma, {
    cascade: true,
  })
  items: SupplierProformaItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
