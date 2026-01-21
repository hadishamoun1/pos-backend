import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PurchaseInvoice } from './purchase-invoice.entity';
import { Supplier } from '../supplier.entity';
import { Account } from '../account.entity';
import { PurchaseInvoiceSetting } from '../purchaseInvoiceSettings.entity'; // adjust if your path differs

@Entity('unit_price_modal_rows')
export class UnitPriceModalRow {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PurchaseInvoice, (inv) => (inv as any).unitPriceRows, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'invoiceId' })
  invoice: PurchaseInvoice;

  @Column({ nullable: true })
  invoiceId: number;

  @Column({ nullable: true })
  purchaseInvoiceSettingId: number;

  @ManyToOne(() => PurchaseInvoiceSetting, { nullable: true })
  @JoinColumn({ name: 'purchaseInvoiceSettingId' })
  purchaseInvoiceSetting: PurchaseInvoiceSetting;

  @Column({ type: 'varchar', length: 255, nullable: true })
  chargeName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  chargeType: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  value: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  valueOFR: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  valueExch: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  valueExchOFR: number;

  @Column({ type: 'tinyint', default: 0 })
  addToItemCost: boolean;

  @Column({ type: 'tinyint', default: 0,nullable:true })
  invoiceNbTax: boolean;

  @Column({ type: 'tinyint', default: 0 })
  shipping: boolean;

  // Existing fields you already use
  @Column({ name: 'supplierId', type: 'int', nullable: true })
  supplierId: number;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ name: 'accountId', type: 'int', nullable: true })
  accountId: number;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  // ✅ NEW: “Supplier of Tax” target saved in DB
  // If chosen from account 4619 => taxAccountId
  // If chosen supplier => taxSupplierId

  @Column({ name: 'taxAccountId', type: 'int', nullable: true })
  taxAccountId: number;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'taxAccountId' })
  taxAccount: Account;

  @Column({ name: 'taxSupplierId', type: 'int', nullable: true })
  taxSupplierId: number;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'taxSupplierId' })
  taxSupplier: Supplier;
}
