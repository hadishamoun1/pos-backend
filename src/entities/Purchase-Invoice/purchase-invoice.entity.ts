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
import { PurchaseInvoiceItem } from './purchase-invoice-item.entity';
import { UnitPriceModalRow } from './unit-price-modal-row.entity';
import { PurchaseVoucher } from '../Vouchers/purchaseVoucher.entity';
import { JournalVoucher } from '../Vouchers/journalVoucher.entity';

@Entity('purchase_invoices')
export class PurchaseInvoice {
  @PrimaryGeneratedColumn()
  id: number;

  // The real PV/PVG.../PVR.../PVGR... invoice number — only assigned once
  // this invoice's status reaches 'Recieved' (see PurchaseInvoiceService
  // create()/update()). Null while it's still just an order.
  @Column({ type: 'varchar', nullable: true ,unique: true})
  invoiceNumber: string;

  // ORD{YY}-### — assigned at creation for any invoice created directly at
  // Ordered/Shipped (not via Proforma), and kept unchanged through
  // Ordered -> Shipped. Independent sequence from invoiceNumber, so it
  // never collides with the PV series.
  @Column({ type: 'varchar', nullable: true, unique: true })
  orderNumber: string | null;

  // PRO{YY}-### — assigned at creation for invoices starting at Proforma
  // (the normal case, since new invoices default there). Its own sequence,
  // separate from orderNumber/invoiceNumber.
  @Column({ type: 'varchar', nullable: true, unique: true })
  proformaNumber: string | null;

  // Set on an Ordered/Shipped/Recieved invoice that was spun off from a
  // Proforma via "Create Order" (see PurchaseInvoiceService.
  // createOrderFromProforma()) — the Proforma itself is never mutated into
  // an order, it stays a permanent, unchanged record; this is how the
  // Purchase Invoice page finds which orders/shipments belong to it.
  @ManyToOne(() => PurchaseInvoice, { nullable: true })
  @JoinColumn({ name: 'sourceProformaId' })
  sourceProforma: PurchaseInvoice | null;

  @Column({ type: 'int', nullable: true })
  sourceProformaId: number | null;

  // Manually toggled by the user — nothing else derives this (not remaining
  // quantities, not linked orders' statuses). Purely "I'm done splitting
  // orders off this proforma", so the Proforma column's Completed filter
  // has something to go on.
  @Column({ type: 'boolean', default: false })
  isCompleted: boolean;

  @Column({ type: 'varchar', nullable: true })
  supplierInvoiceNumber: string;

  @Column({
    type: 'date',
    transformer: {
      // when writing to the DB we accept a Date or a YYYY‑MM‑DD string
      to: (value: Date | string) =>
        value instanceof Date ? value.toISOString().slice(0, 10) : value,
      // when reading from the DB we’ll return a Date set at midnight UTC
      from: (value: string) =>
        value ? new Date(value + 'T00:00:00.000Z') : null,
    },
  })
  date: Date;

  @Column({ type: 'date', nullable: true })
  poDate: string; // normal date

  
@Column({
  type: 'date',
  nullable: true,
  transformer: {
    to: (value: Date | string) =>
      value instanceof Date ? value.toISOString().slice(0, 10) : value,
    from: (value: string) => (value ? new Date(value + 'T00:00:00.000Z') : null),
  },
})
jvDate: Date | null;

  @Column({ type: 'date', nullable: true })
  expectedArrivalDate: Date;

  @Column({
    type: 'enum',
    enum: ['S', 'G', 'SR', 'RVR', 'PR'],
    default: 'S',
  })
  type: 'S' | 'G' | 'SR' | 'RVR' | 'PR';

  @Column({ type: 'varchar', nullable: true })
  returnBaseType: 'S' | 'G' | 'SR' | null;

  @ManyToOne(() => Supplier)
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column()
  supplierId: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  vatAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  vatPercent: number;

  @Column({ type: 'decimal', precision: 30, scale: 2 })
  grandAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  exchangeRate: number;

  @Column({
    type: 'enum',
    // Lifecycle: Proforma (initial quote, before it's a firm order) ->
    // Ordered -> Shipped -> Recieved.
    enum: ['Proforma', 'Ordered', 'Shipped', 'Recieved'],
    default: 'Proforma',
  })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  shippingLine: string;

  @Column({ type: 'date', nullable: true })
  etd: string;

  @Column({ type: 'int', default: 0 })
  numberOfContainers: number;

  @Column({ type: 'varchar', nullable: true })
  blNumber: string;

  // Set when shipping via a freight forwarder: they hold the real BL and
  // issue us a house bill whose number means nothing to ShipsGo (it's not
  // the carrier's own reference). The container number is carrier-agnostic
  // and always resolvable, so it's kept as an alternate way to track the
  // same shipment when blNumber alone won't work. Either field (or both)
  // can be used to start tracking — see trackShipment().
  @Column({ type: 'varchar', nullable: true })
  containerNumber: string | null;

  // Relative path (under uploads/) to the scanned original Bill of Lading,
  // once one has been uploaded. blNumber is auto-filled from this scan via
  // Claude when it's first uploaded, but stays editable afterward.
  @Column({ type: 'varchar', nullable: true })
  blDocumentPath: string | null;

  // Link to the ShipsGo shipment tracking this invoice's BL, once "Track
  // Shipment" has been used. shipsgoStatus/shipsgoLastCheckedAt are the raw
  // ShipsGo ocean status enum and when we last polled it — kept here so the
  // scheduled sync doesn't need an extra ShipsGo call just to detect "nothing
  // changed".
  @Column({ type: 'varchar', nullable: true })
  shipsgoShipmentId: string | null;

  @Column({ type: 'varchar', nullable: true })
  shipsgoStatus: string | null;

  @Column({ type: 'timestamp', nullable: true })
  shipsgoLastCheckedAt: Date | null;

  // Charter-party / bulk-vessel tracking (AIS, via VesselAPI) — a separate
  // path from ShipsGo above, used when there's no liner carrier/booking
  // number at all (e.g. a chartered break-bulk vessel), only a vessel name
  // off the BL. vesselName is auto-filled from the BL scan like blNumber is;
  // imo/mmsi are filled in once the user confirms which vessel it is from a
  // name search (names aren't unique).
  @Column({ type: 'varchar', nullable: true })
  vesselName: string | null;

  @Column({ type: 'varchar', nullable: true })
  vesselImo: string | null;

  @Column({ type: 'varchar', nullable: true })
  vesselMmsi: string | null;

  @Column({ type: 'decimal', precision: 9, scale: 5, nullable: true })
  vesselLastLat: number | null;

  @Column({ type: 'decimal', precision: 9, scale: 5, nullable: true })
  vesselLastLon: number | null;

  @Column({ type: 'int', nullable: true })
  vesselNavStatus: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true })
  vesselSpeedKnots: number | null;

  // Name of the nearest known port once the vessel is detected as
  // anchored/moored there — a heuristic signal, not proof cargo was
  // unloaded, so it never auto-promotes status past 'Shipped' on its own.
  @Column({ type: 'varchar', nullable: true })
  vesselArrivedAtPort: string | null;

  @Column({ type: 'timestamp', nullable: true })
  vesselArrivedAt: Date | null;

  // When WE last polled VesselAPI — not the same as how fresh the position
  // itself is. A vessel's own AIS provider feed can stall for a given
  // vessel (confirmed happening in practice), so "checked recently" can be
  // true while the underlying fix is actually days old — vesselPositionAt
  // below is the honest freshness signal, sourced from VesselAPI's own
  // reported AIS timestamp rather than our poll time.
  @Column({ type: 'timestamp', nullable: true })
  vesselLastCheckedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  vesselPositionAt: Date | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  potentialCost: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  shippingCost: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  finalCost: number;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'Shamoun' })
  warehouse: string;

  @OneToMany(() => PurchaseInvoiceItem, (item) => item.invoice, {
    cascade: true,
  })
  items: PurchaseInvoiceItem[];

  @OneToMany(() => UnitPriceModalRow, (row) => row.invoice)
  unitPriceRows: UnitPriceModalRow[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => PurchaseVoucher, (v) => v.purchaseInvoice)
  vouchers: PurchaseVoucher[];

  @OneToMany(() => JournalVoucher, (jv) => jv.invoice)
  journalVouchers: JournalVoucher[];
}
