import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SupplierProforma } from './supplierProforma.entity';

@Entity('supplier_proforma_items')
export class SupplierProformaItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SupplierProforma, (proforma) => proforma.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'proforma_id' })
  proforma: SupplierProforma;

  @Column({ type: 'varchar', length: 255 })
  itemName: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  length: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  width: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  fobPrice: number;

  @Column({ type: 'int' })
  containersNumber: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  cfrPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  finalCost: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  costPercentage: number;
}
