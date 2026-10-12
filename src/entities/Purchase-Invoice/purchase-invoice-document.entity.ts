import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { PurchaseInvoice } from './purchase-invoice.entity';

// Plain supporting-document attachments on a purchase invoice (packing list,
// commercial invoice copy, certificate of origin, etc.) — unlike
// blDocumentPath on PurchaseInvoice, these are just stored and served back
// as-is. No Claude extraction, no auto-filled fields, any number per invoice.
@Entity('purchase_invoice_documents')
export class PurchaseInvoiceDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PurchaseInvoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchaseInvoiceId' })
  invoice: PurchaseInvoice;

  @Column()
  purchaseInvoiceId: number;

  // Relative path under uploads/, mirroring blDocumentPath's convention.
  @Column({ type: 'varchar' })
  filePath: string;

  @Column({ type: 'varchar' })
  originalFileName: string;

  @Column({ type: 'varchar', nullable: true })
  mimeType: string | null;

  @Column({ type: 'int', nullable: true })
  fileSize: number | null;

  @CreateDateColumn()
  uploadedAt: Date;
}
