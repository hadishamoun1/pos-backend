import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Supplier } from './suppliers.entity';
import { IsNumber, Min, IsPositive, IsString } from 'class-validator';

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

  @Column({ type: 'date', nullable: false })
  date: Date;

  @Column({ type: 'varchar', length: 255 ,nullable: true})
  @IsString()
  itemName: string;

  @Column({ type: 'decimal', precision: 10, scale: 2,nullable: true })
  @IsPositive()
  length: number;

  @Column({ type: 'decimal', precision: 10, scale: 2,nullable: true })
  @IsPositive()
  width: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 ,nullable: true})
  @Min(0)
  fobPrice: number;

  @Column({ type: 'int', default: 0,nullable: true })
  @Min(0)
  containersNumber: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 ,nullable: true})
  @Min(0)
  invoiceAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 ,nullable: true})
  @Min(0)
  shippingCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  totalInvoiceAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 ,nullable: true})
  @Min(0)
  customs: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  customsLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  customsExchangeRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 ,nullable: true})
  @Min(0)
  tva: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  tvaLL: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 ,nullable: true})
  @Min(0)
  fio: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  fioTva: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  transport: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 ,nullable: true})
  @Min(0)
  transportTva: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  transferFees: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  totalFees: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 ,nullable: true})
  @Min(0)
  totalTva: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  cfrPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0,nullable: true })
  @Min(0)
  finalCost: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0,nullable: true })
  @Min(0)
  costPercentage: number;
}
