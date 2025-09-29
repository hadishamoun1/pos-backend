import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { CurrencyRate } from '../currencyRate.entity';
import { JournalVoucherDetail } from './journalVoucherDetails.entity';
import { PurchaseInvoice } from '../Purchase-Invoice/purchase-invoice.entity';
import { ReceiptEntry } from '../recievables.entities';

@Entity('journal_vouchers')
export class JournalVoucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date',nullable:true })
  date: Date;

  @Column({ type: 'varchar', length: 50, unique: false })
  jvNumber: string;

  @Column({ type: 'decimal', precision: 50, scale: 2,default:0 })
  totalDr: number;

  @Column({ type: 'decimal', precision: 50, scale: 2,default:0  })
  totalDrUSD: number;

  @Column({ type: 'decimal', precision: 50, scale: 2,default:0  })
  totalDrLL: number;

  @Column({ type: 'decimal', precision: 50, scale: 2,default:0  })
  totalDrOFR: number;

  @Column({ type: 'decimal', precision: 50, scale: 2,default:0  })
  totalDrUSDOFR: number;

  @Column({ type: 'decimal', precision: 50, scale: 2,default:0  })
  totalDrLLOFR: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 ,default:0 })
  totalCr: number;

  @Column({ type: 'decimal', precision: 50, scale: 2,default:0  })
  totalCrUSD: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 ,default:0 })
  totalCrLL: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 ,default:0 })
  totalCrOFR: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 ,default:0 })
  totalCrUSDOFR: number;

  @Column({ type: 'decimal', precision: 50, scale: 2 ,default:0 })
  totalCrLLOFR: number;

  @Column({ type: 'varchar', length: 3 })
  jvType: string;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateAcc: CurrencyRate;

  @ManyToOne(() => CurrencyRate, { nullable: true })
  exchangeRateUSD: CurrencyRate;

  @OneToMany(() => JournalVoucherDetail, (detail) => detail.journalVoucher, {
    cascade: true,
  })
  details: JournalVoucherDetail[];

  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.journalVouchers, {
    nullable: true,
  })
  @JoinColumn({ name: 'purchaseInvoiceId' })
  invoice: PurchaseInvoice;

  @Column({ nullable: true })
  purchaseInvoiceId: number;

  // Inverse of ReceiptEntry.journalVoucher
  @OneToMany(() => ReceiptEntry, (entry) => entry.journalVoucher)
  receiptEntries: ReceiptEntry[];

  @Column({ nullable: true })
  receiptEntryId: number;
}
