import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('purchase_invoice_settings')
export class PurchaseInvoiceSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  chargeName: string;

  @Column({ type: 'enum', enum: ['amount', 'percentage'] })
  type: 'amount' | 'percentage';

  @Column({ type: 'varchar', length: 255 })
  accountNumber: string;

  @Column({ type: 'boolean', default: false })
  atc: boolean;

  @Column({ type: 'boolean', default: false })
  shipping: boolean;

  @Column({ type: 'float', default: 0 })
  value: number;

  @Column({ type: 'float', default: 0 })
  valueEx: number;

  @Column({ type: 'enum', enum: ['USD', 'LL'] })
  currency: 'USD' | 'LL';

  @Column({ type: 'float', default: 1.0 })
  exchangeRate: number;
}
