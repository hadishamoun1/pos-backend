import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Supplier } from '../supplier.entity';
import { PaymentVoucherDetail } from './paymentVoucherDetails.entity';

export type PaymentType = 'Cash USD' | 'Cash LL' | 'Check USD' | 'Check LL';
export type VoucherType = 'S' | 'G';

@Entity('payment_vouchers')
export class PaymentVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  paymentNumber: string;

  @Column({ nullable: true })
  supplierId: number;

  @ManyToOne(() => Supplier, (supplier) => supplier.paymentVouchers, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ type: 'varchar', length: 50 })
  paymentType: PaymentType;

  @Column({ type: 'varchar', length: 1 })
  type: VoucherType;

  @Column({ type: 'date', nullable: true })
  date: string;

  @Column({ type: 'varchar', nullable: true })
  invoiceId: string;

  @Column({ type: 'varchar', nullable: true })
  doneBy: string;

  @CreateDateColumn()
  dateCreated: string;

  @UpdateDateColumn()
  dateModified: string;

  @OneToMany(() => PaymentVoucherDetail, (detail) => detail.paymentVoucher, {
    cascade: true,
  })
  details: PaymentVoucherDetail[];
}