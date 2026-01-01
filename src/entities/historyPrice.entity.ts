
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('history-prices')
export class CsvImport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  itemNumber: string;

  @Column({ type: 'date', nullable: true })
  invoiceDate: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  invoiceNbr: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  itemName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  itemBrand: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  propertyCode: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  qty: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  qtyUnit: string;

  @Column({ type: 'int', nullable: true })
  sheet: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  sqm: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  itemSalePrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  vat: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  length: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  width: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}