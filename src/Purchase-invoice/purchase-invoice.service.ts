// src/Purchase-invoice/purchase-invoice.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import {
  Repository,
  In,
  Not,
  IsNull,
  EntityManager,
  SelectQueryBuilder,
  Brackets,
  DeepPartial
} from 'typeorm';
import { ShipsgoService } from '../shipsgo/shipsgo.service';
import { VesselTrackingService, NAV_STATUS } from '../vessel-tracking/vessel-tracking.service';
import { BlExtractionService } from './bl-extraction.service';
import { Transfer } from '../entities/inventory/transfer.entity';
import * as fs from 'fs';
import * as path from 'path';

import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { PurchaseInvoiceDocument } from '../entities/Purchase-Invoice/purchase-invoice-document.entity';
import { compressUploadedFile } from '../common/compress-uploaded-file';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity';
import { SharedCharge } from '../entities/Purchase-Invoice/shared-charge.entity';
import { SharedChargeAllocation } from '../entities/Purchase-Invoice/shared-charge-allocation.entity';
import { PurchaseVoucher } from '../entities/Vouchers/purchaseVoucher.entity';
import { PurchaseVoucherDetail } from '../entities/Vouchers/purchaseVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { ItemBatch } from '../entities/inventory/itemBatch.entity';
import { InventoryCount } from '../entities/inventory/count.entity';
import { ItemNameDescription } from '../entities/inventory/itemNameDescription.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { Item } from '../entities/inventory/item.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Settings } from '../entities/settings.entity';
import { AccountingResolverService } from '../accountRoleMap/accounting-resolver.service';
import { computeDiff } from '../common/compute-diff';


export type Chain = 'OFR' | 'VM';

// Used to set a real Content-Type when streaming an attached file back —
// without it, the browser has no idea what it's looking at and can render
// garbage (e.g. Firefox trying to parse an untyped blob as XML).
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function mimeTypeFromExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return EXTENSION_MIME_TYPES[ext] || 'application/octet-stream';
}

export const num = (v: any, fb = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fb;

/** qty used in cost formula */
export const getItemQty = (it: any, chain: Chain) =>
  chain === 'OFR'
    ? num(it?.sqmOfr ?? it?.sqmofr ?? it?.sqmOFR ?? it?.sqm_ofr ?? 0)
    : num(it?.sqm ?? 0);

/** cost per sqm used in cost formula */
export const getItemCost = (it: any, chain: Chain) =>
  chain === 'OFR'
    ? num(
        it?.finalOFR ??
          it?.finalOfr ??
          it?.finalcostofr ??
          it?.finalCostOfr ??
          0,
      )
    : num(it?.finalCost ?? it?.finalcost ?? it?.finalcostvm ?? 0);

// ShipsGo's ocean status enum, bucketed into what it means for a purchase
// invoice: null = still just booked, not sailing yet, so no invoice status
// change; 'Shipped' = vessel is under way; 'Recieved' = it has arrived at the
// discharge port. Mirrors the frontend's grouping in ShipmentTrackingMap.jsx.
const SHIPSGO_STATUS_TO_INVOICE_STATUS: Record<string, 'Shipped' | 'Recieved' | null> = {
  NEW: null,
  BOOKED: null,
  UNTRACKED: null,
  INPROGRESS: 'Shipped',
  LOADED: 'Shipped',
  SAILING: 'Shipped',
  ARRIVED: 'Recieved',
  DISCHARGED: 'Recieved',
};

const INVOICE_STATUS_RANK: Record<string, number> = {
  Proforma: -1,
  Ordered: 0,
  Shipped: 1,
  Recieved: 2,
};

// Known discharge ports for arrival detection on vessel-tracked (charter/
// bulk) invoices — deliberately just the handful actually used, rather than
// a full geocoding lookup. Add ports here as needed.
const KNOWN_PORTS: { name: string; lat: number; lon: number }[] = [
  { name: 'Beirut Port', lat: 33.9025, lon: 35.5188 },
  { name: 'Saida Port', lat: 33.5606, lon: 35.3706 },
  { name: 'Tripoli Port', lat: 34.4489, lon: 35.8362 },
];

// Meters within which the vessel counts as "at" a known port. Deliberately
// wide (250km) by request — every tracked shipment is inbound to one of
// these ports as its actual final destination (no transit-through case to
// worry about), and this radius needs to be generous enough to still catch
// arrival even when a vessel's position feed has stalled well before the
// real approach (seen in practice). Tradeoff accepted: this can mark an
// invoice Recieved while the vessel is still up to a day or so out.
const PORT_ARRIVAL_RADIUS_METERS = 250000;

// Haversine distance in meters between two lat/lon points.
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findArrivedPort(lat: number, lon: number): string | null {
  for (const port of KNOWN_PORTS) {
    if (distanceMeters(lat, lon, port.lat, port.lon) <= PORT_ARRIVAL_RADIUS_METERS) {
      return port.name;
    }
  }
  return null;
}

@Injectable()
export class PurchaseInvoiceService {
  private readonly logger = new Logger(PurchaseInvoiceService.name);

  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepo: Repository<PurchaseInvoice>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTxRepo: Repository<InventoryTransaction>,

    @InjectRepository(PurchaseVoucher)
    private readonly voucherRepo: Repository<PurchaseVoucher>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(UnitPriceModalRow)
    private readonly rowRepo: Repository<UnitPriceModalRow>,

    @InjectRepository(PurchaseInvoiceItem)
    private readonly itemRepo: Repository<PurchaseInvoiceItem>,

    @InjectRepository(ItemVariant)
    private readonly variantRepo: Repository<ItemVariant>,

    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepo: Repository<JournalVoucher>,

    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepo: Repository<JournalVoucherDetail>,

    @InjectRepository(ItemBatch)
    private readonly itemBatchRepo: Repository<ItemBatch>,

    @InjectRepository(ItemNameDescription)
    private readonly descRepo: Repository<ItemNameDescription>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepo: Repository<InvoiceItem>,

    @InjectRepository(Settings)
private readonly settingsRepo: Repository<Settings>,

    @InjectRepository(PurchaseInvoiceDocument)
    private readonly documentRepo: Repository<PurchaseInvoiceDocument>,

    @InjectRepository(SharedCharge)
    private readonly sharedChargeRepo: Repository<SharedCharge>,

    @InjectRepository(SharedChargeAllocation)
    private readonly sharedChargeAllocationRepo: Repository<SharedChargeAllocation>,

private readonly accountingResolver: AccountingResolverService,

    private readonly shipsgoService: ShipsgoService,

    private readonly vesselTrackingService: VesselTrackingService,

    private readonly blExtractionService: BlExtractionService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // ShipsGo shipment tracking link
  // ────────────────────────────────────────────────────────────

  // Minimal list of invoices that have a linked ShipsGo shipment, so the
  // Shipment Tracking page can label each tracked shipment with its PO /
  // invoice number instead of just the raw ShipsGo reference.
  async getShipmentLinks() {
    const invoices = await this.invoiceRepo.find({
      where: { shipsgoShipmentId: Not(IsNull()) } as any,
      relations: ['supplier'],
    });
    return invoices.map((inv) => ({
      shipsgoShipmentId: inv.shipsgoShipmentId,
      invoiceId: inv.id,
      // Still just Ordered/Shipped invoices won't have a real invoiceNumber
      // yet — fall back to the order number so the tracking page has
      // something meaningful to show instead of blank.
      invoiceNumber:
        inv.invoiceNumber ||
        (inv as any).orderNumber ||
        (inv as any).proformaNumber ||
        inv.supplierInvoiceNumber ||
        null,
      isOrderNumber: !inv.invoiceNumber && !!((inv as any).orderNumber || (inv as any).proformaNumber),
      supplierName: (inv as any).supplier?.supplierName ?? null,
      status: inv.status,
    }));
  }

  // Same idea as getShipmentLinks() above, but for charter/bulk invoices
  // tracked by vessel (AIS) instead of a ShipsGo booking — the Shipment
  // Tracking map renders both lists as two marker types on the same map.
  async getVesselLinks() {
    const invoices = await this.invoiceRepo.find({
      where: [
        { vesselImo: Not(IsNull()) } as any,
        { vesselMmsi: Not(IsNull()) } as any,
      ],
      relations: ['supplier'],
    });
    return invoices.map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber:
        inv.invoiceNumber ||
        (inv as any).orderNumber ||
        (inv as any).proformaNumber ||
        inv.supplierInvoiceNumber ||
        null,
      isOrderNumber: !inv.invoiceNumber && !!((inv as any).orderNumber || (inv as any).proformaNumber),
      supplierName: (inv as any).supplier?.supplierName ?? null,
      status: inv.status,
      vesselName: inv.vesselName,
      vesselImo: inv.vesselImo,
      vesselMmsi: inv.vesselMmsi,
      lat: inv.vesselLastLat != null ? Number(inv.vesselLastLat) : null,
      lon: inv.vesselLastLon != null ? Number(inv.vesselLastLon) : null,
      navStatus: inv.vesselNavStatus,
      speedKnots: inv.vesselSpeedKnots != null ? Number(inv.vesselSpeedKnots) : null,
      arrivedAtPort: inv.vesselArrivedAtPort,
      lastCheckedAt: inv.vesselLastCheckedAt,
      positionAt: inv.vesselPositionAt,
    }));
  }

  // Saves the uploaded scanned BL document and tries to auto-fill blNumber
  // (or containerNumber / vesselName, depending on mode) from it via Claude.
  // Extraction failing (bad scan, no key configured) never blocks the
  // upload itself — the file is saved either way and the caller can see
  // whether anything was actually found.
  //
  // mode/modeLocked mirror Summary View 2's tracking-method picker: once
  // the user has deliberately chosen a method, this only ever writes the
  // one field that method uses — even if Claude also happens to find a
  // vessel name or container number on the document (e.g. a normal liner
  // BL always has *a* "Vessel" field too; that's not what this invoice's
  // vesselName means unless it's actually being tracked as a charter).
  // Before a mode is chosen (a still-untouched invoice), it opportunistically
  // fills whatever it finds, so the frontend can auto-detect a charter BL.
  async uploadBlDocument(
    id: number,
    file: Express.Multer.File,
    mode?: string,
    modeLocked?: boolean,
  ) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!file) throw new BadRequestException('No file uploaded.');

    // Clean up whatever was attached before, so we don't accumulate orphaned
    // scans on disk every time a new one is uploaded.
    if (invoice.blDocumentPath) {
      const oldPath = path.join(process.cwd(), 'uploads', invoice.blDocumentPath);
      fs.unlink(oldPath, () => {});
    }

    const { blNumber, found, vesselName, containerNumber, shippingLine } =
      await this.blExtractionService.extractBlNumber(file.path, file.mimetype);

    // Compressed *after* extraction runs against the original, full-quality
    // scan — keeps Claude's reading accuracy unaffected while still shrinking
    // what actually ends up stored long-term.
    const compressed = await compressUploadedFile(file.path, file.mimetype);
    invoice.blDocumentPath = path.join('bl-documents', path.basename(compressed.absolutePath));

    if (modeLocked) {
      if (mode === 'bl' && found && blNumber) {
        invoice.blNumber = blNumber;
      } else if (mode === 'container' && containerNumber) {
        invoice.containerNumber = containerNumber;
      } else if (mode === 'vessel' && vesselName && !invoice.vesselImo && !invoice.vesselMmsi) {
        invoice.vesselName = vesselName;
      }
      // Shipping Line is shared by both liner modes (bl/container) rather
      // than being mode-exclusive like the fields above — it's the same
      // carrier hint either way, and matters for ShipsGo's booking-number
      // lookup specifically (see trackShipment()'s carrier resolution).
      if ((mode === 'bl' || mode === 'container') && shippingLine) {
        invoice.shippingLine = shippingLine;
      }
    } else {
      if (found && blNumber) {
        invoice.blNumber = blNumber;
      }
      if (containerNumber) {
        invoice.containerNumber = containerNumber;
      }
      if (shippingLine) {
        invoice.shippingLine = shippingLine;
      }
      // Don't clobber a name the user already confirmed tracking against.
      if (vesselName && !invoice.vesselName) {
        invoice.vesselName = vesselName;
      }
    }

    const saved = await this.invoiceRepo.save(invoice);
    return { invoice: saved, extracted: { blNumber, found, vesselName, containerNumber, shippingLine } };
  }

  // Absolute path to the invoice's attached BL scan, for viewing/downloading.
  async getBlDocumentAbsolutePath(
    id: number,
  ): Promise<{ absolutePath: string; fileName: string; mimeType: string }> {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice?.blDocumentPath) {
      throw new NotFoundException('No BL document has been uploaded for this invoice.');
    }
    const absolutePath = path.join(process.cwd(), 'uploads', invoice.blDocumentPath);
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException('The BL document file is missing on the server.');
    }
    const fileName = path.basename(invoice.blDocumentPath);
    return { absolutePath, fileName, mimeType: mimeTypeFromExtension(fileName) };
  }

  // ────────────────────────────────────────────────────────────
  // Plain supporting documents (packing list, invoice copy, certificate of
  // origin, etc.) — just stored and served back as-is, any number per
  // invoice, no Claude extraction. Separate from blDocumentPath above.
  // ────────────────────────────────────────────────────────────

  async uploadDocuments(id: number, files: Express.Multer.File[]) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!files?.length) throw new BadRequestException('No files uploaded.');

    // Sequential (not Promise.all) so several large PDFs don't all spawn
    // Ghostscript at once.
    const docs: PurchaseInvoiceDocument[] = [];
    for (const file of files) {
      const compressed = await compressUploadedFile(file.path, file.mimetype);
      docs.push(
        this.documentRepo.create({
          purchaseInvoiceId: id,
          filePath: path.join('purchase-invoice-documents', path.basename(compressed.absolutePath)),
          originalFileName: file.originalname,
          mimeType: compressed.mimetype,
          fileSize: compressed.size,
        }),
      );
    }
    return this.documentRepo.save(docs);
  }

  async listDocuments(id: number) {
    return this.documentRepo.find({
      where: { purchaseInvoiceId: id } as any,
      order: { uploadedAt: 'DESC' },
    });
  }

  async getDocumentAbsolutePath(
    id: number,
    docId: number,
  ): Promise<{ absolutePath: string; fileName: string; mimeType: string }> {
    const doc = await this.documentRepo.findOne({ where: { id: docId, purchaseInvoiceId: id } as any });
    if (!doc) throw new NotFoundException('Document not found.');
    const absolutePath = path.join(process.cwd(), 'uploads', doc.filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException('The document file is missing on the server.');
    }
    return {
      absolutePath,
      fileName: doc.originalFileName,
      mimeType: doc.mimeType || mimeTypeFromExtension(absolutePath),
    };
  }

  async deleteDocument(id: number, docId: number) {
    const doc = await this.documentRepo.findOne({ where: { id: docId, purchaseInvoiceId: id } as any });
    if (!doc) throw new NotFoundException('Document not found.');
    const absolutePath = path.join(process.cwd(), 'uploads', doc.filePath);
    fs.unlink(absolutePath, () => {});
    await this.documentRepo.remove(doc);
    return { success: true };
  }

  // ────────────────────────────────────────────────────────────
  // Shared charges — a single cost (typically customs clearance) that
  // actually covers two or more invoices, e.g. two separate orders that
  // arrived on the same vessel and were cleared through customs together.
  // Split proportionally by each invoice's grand amount (grandAmount),
  // matching how the existing cost formulas already spread shipping/charges
  // across items WITHIN one invoice — by dollar value, not SQM (see
  // realCalculatePriceCFR/getCostPercentage in purchases-invoice.jsx). Each
  // invoice's computed share is written as a normal charge row (the same
  // UnitPriceModalRow shape a manually-entered charge uses), so it flows
  // through the exact same downstream calculations — both the backend's
  // SQM-weighted average-cost recompute and the frontend's live Summary 1
  // final-cost display — with no separate calculation path of its own.
  // ────────────────────────────────────────────────────────────

  async createSharedCharge(dto: {
    description: string;
    totalAmount: number;
    currency: string;
    invoiceIds: number[];
    chargeName?: string;
    addToItemCost?: boolean;
    shipping?: boolean;
  }) {
    const invoiceIds = Array.from(new Set((dto.invoiceIds || []).map((n) => Number(n))));
    if (invoiceIds.length < 2) {
      throw new BadRequestException('Select at least two invoices to split a shared charge across.');
    }

    const total = Number(dto.totalAmount);
    if (!Number.isFinite(total) || total <= 0) {
      throw new BadRequestException('Enter a valid total amount.');
    }

    if (!dto.description?.trim()) {
      throw new BadRequestException('Enter a description for this shared charge.');
    }

    const invoices = await this.invoiceRepo.find({ where: { id: In(invoiceIds) } as any });
    if (invoices.length !== invoiceIds.length) {
      throw new BadRequestException('One or more selected invoices could not be found.');
    }

    // By value — proportional to each invoice's grand amount.
    const weights = invoices.map((inv) => Number((inv as any).grandAmount || 0));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) {
      throw new BadRequestException(
        'Selected invoices have no value to split proportionally by.',
      );
    }

    // Round each share to 2dp; the last invoice absorbs the rounding
    // remainder so the allocated amounts always sum exactly to the entered
    // total.
    const shares = weights.map((w) => Math.round((w / totalWeight) * total * 100) / 100);
    const roundedSum = shares.reduce((a, b) => a + b, 0);
    const diff = Math.round((total - roundedSum) * 100) / 100;
    if (diff !== 0) shares[shares.length - 1] = Math.round((shares[shares.length - 1] + diff) * 100) / 100;

    const chargeName = dto.chargeName?.trim() || dto.description.trim();
    const addToItemCost = dto.addToItemCost ?? true;
    const shipping = dto.shipping ?? false;

    const sharedCharge = await this.sharedChargeRepo.save(
      this.sharedChargeRepo.create({
        description: dto.description.trim(),
        totalAmount: total,
        currency: dto.currency || 'USD',
        allocationMethod: 'value',
      } as any),
    );

    const results: any[] = [];

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const amount = shares[i];

      const row = await this.rowRepo.save(
        this.rowRepo.create({
          invoiceId: inv.id,
          chargeName,
          chargeType: 'amount',
          value: amount,
          valueOFR: amount,
          currency: dto.currency || 'USD',
          valueExch: 0,
          valueExchOFR: 0,
          addToItemCost,
          shipping,
        } as any),
      );

      await this.sharedChargeAllocationRepo.save(
        this.sharedChargeAllocationRepo.create({
          sharedChargeId: (sharedCharge as any).id,
          purchaseInvoiceId: inv.id,
          allocatedAmount: amount,
          weight: weights[i],
          unitPriceRowId: (row as any).id,
        } as any),
      );

      await this.computeAndWriteCostsForInvoice(inv.id);

      results.push({
        invoiceId: inv.id,
        invoiceNumber:
          (inv as any).invoiceNumber || (inv as any).orderNumber || (inv as any).proformaNumber || null,
        weight: weights[i],
        allocatedAmount: amount,
      });
    }

    return { sharedCharge, allocations: results };
  }

  // Every shared charge this invoice has ever been part of, plus which
  // other invoices it was split with — for tracing where a charge row on
  // this invoice actually came from.
  async getSharedChargesForInvoice(invoiceId: number) {
    const myAllocations = await this.sharedChargeAllocationRepo.find({
      where: { purchaseInvoiceId: invoiceId } as any,
      relations: ['sharedCharge'],
    });
    if (!myAllocations.length) return [];

    const sharedChargeIds = Array.from(
      new Set(myAllocations.map((a: any) => a.sharedChargeId)),
    );
    const allAllocations = await this.sharedChargeAllocationRepo.find({
      where: { sharedChargeId: In(sharedChargeIds) } as any,
      relations: ['purchaseInvoice'],
    });

    return myAllocations.map((a: any) => ({
      sharedChargeId: a.sharedChargeId,
      description: a.sharedCharge?.description,
      totalAmount: Number(a.sharedCharge?.totalAmount || 0),
      currency: a.sharedCharge?.currency,
      myAllocatedAmount: Number(a.allocatedAmount || 0),
      otherInvoices: allAllocations
        .filter((x: any) => x.sharedChargeId === a.sharedChargeId && x.purchaseInvoiceId !== invoiceId)
        .map((x: any) => ({
          invoiceId: x.purchaseInvoiceId,
          invoiceNumber:
            x.purchaseInvoice?.invoiceNumber ||
            x.purchaseInvoice?.orderNumber ||
            x.purchaseInvoice?.proformaNumber ||
            null,
          allocatedAmount: Number(x.allocatedAmount || 0),
        })),
    }));
  }

  // Starts ShipsGo tracking for this invoice's BL number and/or container
  // number — either is enough (ShipsGo accepts one, the other, or both).
  // The container number matters when shipping via a freight forwarder:
  // they hold the real BL and issue a house bill whose number ShipsGo can't
  // resolve, but the container number is carrier-agnostic and always works.
  // Manual/on-demand because each call spends 1 ShipsGo credit — never
  // fired automatically.
  async trackShipment(id: number) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    const blNumber = invoice.blNumber?.trim();
    const containerNumber = invoice.containerNumber?.trim();
    if (!blNumber && !containerNumber) {
      throw new BadRequestException(
        'Enter a BL number or a container number before starting shipment tracking.',
      );
    }
    if (invoice.shipsgoShipmentId) {
      throw new BadRequestException('This invoice is already linked to a ShipsGo shipment.');
    }

    const reference = invoice.invoiceNumber || invoice.supplierInvoiceNumber || `PI-${invoice.id}`;
    // Tell ShipsGo which carrier this booking number belongs to when we can
    // resolve one — without it, ShipsGo can only guess from the booking
    // number's format, which works for a handful of major lines and can
    // silently fail to resolve smaller/regional ones (e.g. SITC). The
    // `carrier` field only accepts a code from ShipsGo's own list (a 422
    // "invalid format" means whatever we sent wasn't in it) — free text like
    // the shipping-line name typed on the invoice, or a made-up fallback,
    // gets rejected outright. So: try to resolve a real code, and if we
    // can't, omit the field rather than send something guaranteed-invalid —
    // that's still strictly better than the 422 this used to cause.
    const carrierCode = await this.resolveShipsgoCarrierCode(invoice.shippingLine);
    const result = await this.shipsgoService.createShipment({
      reference,
      ...(blNumber ? { booking_number: blNumber } : {}),
      ...(containerNumber ? { container_number: containerNumber } : {}),
      ...(carrierCode ? { carrier: carrierCode } : {}),
    });

    // Actual shape is { message: "SUCCESS", shipment: { id, ... } } — kept
    // the other fallbacks in case that ever changes.
    const shipmentId =
      result?.shipment?.id ?? result?.id ?? result?.shipmentId ?? result?.data?.id ?? null;
    if (!shipmentId) {
      throw new BadRequestException(
        `ShipsGo didn't return a shipment id for this BL number. Raw response: ${JSON.stringify(result)}`,
      );
    }

    invoice.shipsgoShipmentId = String(shipmentId);
    invoice.shipsgoStatus = result?.shipment?.status ?? result?.status ?? null;
    invoice.shipsgoLastCheckedAt = new Date();
    await this.invoiceRepo.save(invoice);

    return { invoice, shipsgoResponse: result };
  }

  // Looks up the shipping-line text typed on the invoice against ShipsGo's
  // own carrier list and returns the matching code, or null if there's no
  // confident match (blank field, or nothing close enough). The list's
  // exact field names aren't nailed down from docs, so this reads
  // defensively across a few likely shapes and logs the raw list once if
  // none of them work, rather than silently resolving nothing forever.
  private async resolveShipsgoCarrierCode(shippingLine: string | null | undefined): Promise<string | null> {
    const query = shippingLine?.trim().toLowerCase();
    if (!query) return null;

    let carriers: any[];
    try {
      carriers = await this.shipsgoService.listCarriers();
    } catch (err: any) {
      this.logger.warn(`Couldn't fetch ShipsGo carrier list: ${err?.message || err}`);
      return null;
    }

    if (!Array.isArray(carriers) || carriers.length === 0) {
      this.logger.warn(`ShipsGo carrier list came back empty/unexpected: ${JSON.stringify(carriers)}`);
      return null;
    }

    const nameOf = (c: any) => String(c?.name ?? c?.carrier_name ?? c?.carrierName ?? '').toLowerCase();
    const codeOf = (c: any) => c?.code ?? c?.scac ?? c?.carrier_code ?? c?.carrierCode ?? null;

    const exact = carriers.find((c) => nameOf(c) === query);
    const partial = exact || carriers.find((c) => nameOf(c).includes(query) || query.includes(nameOf(c)));
    const code = partial ? codeOf(partial) : null;

    if (!code) {
      this.logger.warn(
        `No ShipsGo carrier match for "${shippingLine}" — tracking without a carrier hint. Sample of list: ${JSON.stringify(carriers.slice(0, 3))}`,
      );
    }
    return code ? String(code) : null;
  }

  // Re-applies the current invoice status + a fresh ShipsGo status check, on
  // demand (e.g. a "Refresh" button) rather than waiting for the next cron tick.
  async syncShipmentStatus(id: number) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!invoice.shipsgoShipmentId) {
      throw new BadRequestException('This invoice has no linked ShipsGo shipment yet.');
    }
    await this.applyShipsgoStatusToInvoice(invoice);
    return this.invoiceRepo.findOne({ where: { id } as any });
  }

  // Unlinks this invoice from its ShipsGo shipment — for when the wrong BL
  // was tracked by mistake. Best-effort deletes the shipment on ShipsGo's
  // side too (frees the credit/slot); if that fails (already gone, API
  // hiccup) we still clear our own link rather than leave the user stuck.
  async untrackShipment(id: number) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!invoice.shipsgoShipmentId) {
      throw new BadRequestException('This invoice has no linked ShipsGo shipment to remove.');
    }

    try {
      await this.shipsgoService.deleteShipment(invoice.shipsgoShipmentId);
    } catch (err: any) {
      this.logger.warn(
        `Couldn't delete ShipsGo shipment ${invoice.shipsgoShipmentId} (invoice ${id}): ${err?.message || err}. Unlinking locally anyway.`,
      );
    }

    invoice.shipsgoShipmentId = null;
    invoice.shipsgoStatus = null;
    invoice.shipsgoLastCheckedAt = null;
    await this.invoiceRepo.save(invoice);
    return invoice;
  }

  // Checks ShipsGo for every invoice with a linked shipment that hasn't been
  // marked Recieved yet, and promotes Ordered -> Shipped -> Recieved as the
  // shipment sails and arrives. Runs the same `update()` path a manual save
  // would, so the receiving side effects (inventory tx, cost, JVs) fire
  // exactly like they would if a person had flipped the status by hand.
  @Cron('*/30 * * * *')
  async autoSyncShipmentStatuses() {
    const invoices = await this.invoiceRepo.find({
      where: {
        shipsgoShipmentId: Not(IsNull()),
        status: Not('Recieved'),
      } as any,
    });

    for (const invoice of invoices) {
      try {
        await this.applyShipsgoStatusToInvoice(invoice);
      } catch (err: any) {
        this.logger.error(
          `Shipment status sync failed for invoice ${invoice.id} (shipsgo ${invoice.shipsgoShipmentId}): ${err?.message || err}`,
        );
      }
    }
  }

  private async applyShipsgoStatusToInvoice(invoice: PurchaseInvoice) {
    const shipment = await this.shipsgoService.getShipment(invoice.shipsgoShipmentId);
    // createShipment()'s response turned out to wrap the object as
    // { shipment: {...} } rather than returning it directly — checking the
    // same shape here too in case getShipment() follows the same pattern.
    const rawStatus: string | undefined =
      shipment?.status ?? shipment?.shipment?.status ?? shipment?.data?.status;

    // Logged every check (not just failures) — the only way to tell whether
    // a shipment that "hasn't moved" is genuinely stalled on ShipsGo's own
    // end (their last-updated timestamp, if any, staying frozen) versus
    // something in our own parsing not finding the right field, the same
    // ambiguity that turned out to matter for VesselAPI.
    this.logger.log(
      `ShipsGo check for invoice ${invoice.id} (shipment ${invoice.shipsgoShipmentId}): rawStatus=${rawStatus} fetched_at=${new Date().toISOString()} raw=${JSON.stringify(shipment)}`,
    );

    if (!rawStatus) return;

    const mapped = SHIPSGO_STATUS_TO_INVOICE_STATUS[rawStatus] ?? null;
    const shouldPromote =
      mapped && INVOICE_STATUS_RANK[mapped] > (INVOICE_STATUS_RANK[invoice.status] ?? 0);

    if (!shouldPromote) {
      // Nothing to promote — just record what we saw so the next tick can
      // skip work if the status hasn't actually changed.
      await this.invoiceRepo.update(invoice.id, {
        shipsgoStatus: rawStatus,
        shipsgoLastCheckedAt: new Date(),
      } as any);
      return;
    }

    // Re-submit the invoice's current items/unit-price rows unchanged, with
    // only the status (and shipsgo bookkeeping columns) updated — mirrors
    // exactly what a manual save with the status dropdown flipped would send.
    const existing = await this.invoiceRepo.findOne({
      where: { id: invoice.id } as any,
      relations: ['items'],
    });
    if (!existing) return;
    const unitPriceRows = await this.rowRepo.find({ where: { invoiceId: invoice.id } as any });

    await this.update(invoice.id, {
      status: mapped,
      shipsgoStatus: rawStatus,
      shipsgoLastCheckedAt: new Date(),
      // update() has an etd-specific quirk: a payload that omits `etd`
      // entirely still gets it coerced to null. Round-trip the current
      // value explicitly so this status-only sync can't wipe it.
      etd: existing.etd,
      items: existing.items as any,
      unitPriceRows: unitPriceRows as any,
    } as any);

    this.logger.log(`Invoice ${invoice.id} auto-set to ${mapped} (ShipsGo status: ${rawStatus})`);
  }

  // ────────────────────────────────────────────────────────────
  // Vessel (AIS) tracking — for charter-party/bulk shipments that have no
  // liner carrier/booking number at all, only a named vessel off the BL.
  // Separate from ShipsGo above: this only ever auto-promotes as far as
  // 'Shipped', since raw AIS position can't confirm cargo was unloaded —
  // the final flip to 'Recieved' stays a manual confirmation.
  // ────────────────────────────────────────────────────────────

  // Name search is ambiguous (vessel names aren't unique) — returns
  // candidates for the frontend to show a picker; nothing is saved yet.
  async searchVessel(id: number, name: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!name?.trim()) {
      throw new BadRequestException('Enter a vessel name to search for.');
    }
    return this.vesselTrackingService.searchByName(name.trim());
  }

  // Saves the user's picked vessel (from searchVessel's results) onto the
  // invoice and does an initial position fetch right away.
  async trackVessel(
    id: number,
    selection: { imo?: string; mmsi?: string; name: string },
  ) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!selection?.imo && !selection?.mmsi) {
      throw new BadRequestException('No vessel selected — pick one from the search results first.');
    }

    invoice.vesselName = selection.name;
    invoice.vesselImo = selection.imo ? String(selection.imo) : null;
    invoice.vesselMmsi = selection.mmsi ? String(selection.mmsi) : null;
    await this.invoiceRepo.save(invoice);

    await this.applyVesselStatusToInvoice(invoice);
    return this.invoiceRepo.findOne({ where: { id } as any });
  }

  // On-demand re-check of the tracked vessel's position (e.g. a "Refresh"
  // button) rather than waiting for the next cron tick.
  async syncVesselPosition(id: number) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!invoice.vesselImo && !invoice.vesselMmsi) {
      throw new BadRequestException('This invoice has no tracked vessel yet.');
    }
    await this.applyVesselStatusToInvoice(invoice);
    return this.invoiceRepo.findOne({ where: { id } as any });
  }

  // Unlinks the tracked vessel — for when the wrong one was picked from the
  // name-search results. Leaves vesselName as-is so the field goes back to
  // editable/re-searchable instead of forcing the user to retype it; there's
  // no remote side to clean up here (unlike ShipsGo, VesselAPI is just a
  // stateless position lookup, nothing was "created").
  async untrackVessel(id: number) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (!invoice.vesselImo && !invoice.vesselMmsi) {
      throw new BadRequestException('This invoice has no tracked vessel to remove.');
    }

    invoice.vesselImo = null;
    invoice.vesselMmsi = null;
    invoice.vesselLastLat = null;
    invoice.vesselLastLon = null;
    invoice.vesselNavStatus = null;
    invoice.vesselSpeedKnots = null;
    invoice.vesselArrivedAtPort = null;
    invoice.vesselArrivedAt = null;
    invoice.vesselLastCheckedAt = null;
    await this.invoiceRepo.save(invoice);
    return invoice;
  }

  // Checks every invoice with a tracked vessel that hasn't been marked
  // Recieved yet, refreshes its position, and promotes Ordered -> Shipped
  // once it's under way. Runs once a day (not every 30 min like the ShipsGo
  // sync) — a multi-week voyage doesn't need half-hourly checks, and
  // VesselAPI bills per request, unlike ShipsGo's flat per-shipment pricing,
  // so cutting the polling frequency directly cuts the monthly cost here.
  @Cron('0 6 * * *')
  async autoSyncVesselPositions() {
    const invoices = await this.invoiceRepo.find({
      where: [
        { vesselImo: Not(IsNull()), status: Not('Recieved') } as any,
        { vesselMmsi: Not(IsNull()), status: Not('Recieved') } as any,
      ],
    });

    for (const invoice of invoices) {
      try {
        await this.applyVesselStatusToInvoice(invoice);
      } catch (err: any) {
        this.logger.error(
          `Vessel position sync failed for invoice ${invoice.id} (vessel ${invoice.vesselName}): ${err?.message || err}`,
        );
      }
    }
  }

  private async applyVesselStatusToInvoice(invoice: PurchaseInvoice) {
    const idType = invoice.vesselImo ? 'imo' : 'mmsi';
    const id = invoice.vesselImo || invoice.vesselMmsi;
    if (!id) return;

    const position = await this.vesselTrackingService.getPosition(idType, id);
    if (!position) return;

    // Distance-only: originally also required a stopped/anchored reading,
    // but a stalled AIS feed (seen in practice — a vessel's position/speed
    // can freeze on the provider's end for days) means that reading may
    // just never refresh even after real arrival. Being within range of a
    // known port is treated as arrived on its own.
    const arrivedPort = findArrivedPort(position.latitude, position.longitude);
    const isMoored = Boolean(arrivedPort);

    await this.invoiceRepo.update(invoice.id, {
      vesselLastLat: position.latitude,
      vesselLastLon: position.longitude,
      vesselNavStatus: position.nav_status ?? null,
      vesselSpeedKnots: position.sog ?? null,
      vesselLastCheckedAt: new Date(),
      // VesselAPI's own reported AIS fix time — the honest freshness
      // signal, distinct from vesselLastCheckedAt (when we merely asked).
      vesselPositionAt: position.timestamp ? new Date(position.timestamp) : null,
      ...(isMoored && !invoice.vesselArrivedAt
        ? { vesselArrivedAtPort: arrivedPort, vesselArrivedAt: new Date() }
        : {}),
    } as any);

    // Auto-promote Ordered -> Shipped once it's under way, and all the way
    // to Recieved once it's anchored/moored at a known discharge port — per
    // request, mirrors how the ShipsGo path auto-sets Recieved on arrival.
    // Note this posts inventory/accounting the moment it's near port, not
    // when the cargo is actually confirmed offloaded.
    const mapped: 'Shipped' | 'Recieved' | null = isMoored
      ? 'Recieved'
      : position.nav_status === NAV_STATUS.UNDER_WAY_USING_ENGINE
      ? 'Shipped'
      : null;

    const shouldPromote =
      mapped && INVOICE_STATUS_RANK[mapped] > (INVOICE_STATUS_RANK[invoice.status] ?? 0);

    if (!shouldPromote) return;

    const existing = await this.invoiceRepo.findOne({
      where: { id: invoice.id } as any,
      relations: ['items'],
    });
    if (!existing) return;
    const unitPriceRows = await this.rowRepo.find({ where: { invoiceId: invoice.id } as any });

    await this.update(invoice.id, {
      status: mapped,
      etd: existing.etd,
      items: existing.items as any,
      unitPriceRows: unitPriceRows as any,
    } as any);

    this.logger.log(
      `Invoice ${invoice.id} auto-set to ${mapped} (vessel ${invoice.vesselName}${
        mapped === 'Recieved' ? ` arrived at ${arrivedPort}` : ' under way'
      })`,
    );
  }

  // ────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────
  private startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private uniqNums(xs: any[]) {
    return Array.from(new Set(xs.map(Number).filter((n) => Number.isFinite(n) && n > 0)));
  }

private intOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

private numOrZero(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}



  private clampPrevQty(raw: any) {
    let n = Number(raw);
    if (!Number.isFinite(n)) n = 0;
    if (n < 0) n = 0;
    return n;
  }

  // ────────────────────────────────────────────────────────────
  // PREV quantity from tx + fallback to counts
  // ────────────────────────────────────────────────────────────
  private async sumTxQtyDetailed(
    variantIds: number[],
    chain: Chain,
    cutoff: Date,
    currPiiIds: number[],
    useQtyCol = false,
  ): Promise<{ sum: number; txCount: number }> {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return { sum: 0, txCount: 0 };

    // unit items (stockMode=QTY) are counted by quantityofr, not sqmofr
    const col = useQtyCol ? 'tx.quantityofr' : (chain === 'OFR' ? 'tx.sqmofr' : 'tx.sqm');

    const applyBase = (qb: SelectQueryBuilder<InventoryTransaction>) => {
      qb.where('tx.itemVariantId IN (:...ids)', { ids })
        .andWhere('tx.dateForEachInvoice < :cut', { cut: cutoff });

      if (currPiiIds.length) {
        qb.andWhere(
          '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
          { currIds: currPiiIds },
        );
      }
      return qb;
    };

    const qbCount = applyBase(
      this.inventoryTxRepo.createQueryBuilder('tx').select('COUNT(*)', 'cnt'),
    );
    const rawCount = (await qbCount.getRawOne()) as { cnt?: string | number } | undefined;
    const txCount = num(rawCount?.cnt, 0);

    const qbSum = applyBase(
      this.inventoryTxRepo
        .createQueryBuilder('tx')
        .select(`SUM(COALESCE(${col},0))`, 'sum'),
    );
    const raw = (await qbSum.getRawOne()) as { sum?: string | number | null } | undefined;

    return { sum: num(raw?.sum, 0), txCount };
  }

  private async countFallbackPrevQty(
    invManager: EntityManager,
    variantIds: number[],
    chain: Chain,
  ) {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return 0;

    const qtyField = chain === 'OFR' ? 'cnt.sqmOfr' : 'cnt.sqm';

    const qb = invManager
      .getRepository(InventoryCount)
      .createQueryBuilder('cnt')
      .select(`SUM(COALESCE(${qtyField},0))`, 'sumQty')
      .where('cnt.itemVariantId IN (:...ids)', { ids });

    const raw = (await qb.getRawOne()) as { sumQty?: string | number | null } | undefined;
    return num(raw?.sumQty, 0);
  }

  private async openingsWeightedAvg(
    invManager: EntityManager,
    variantIds: number[],
    chain: Chain,
  ) {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return { qty: 0, avg: 0 };

    const qtyField = chain === 'OFR' ? 'cnt.sqmOfr' : 'cnt.sqm';
    const costField = chain === 'OFR' ? 'cnt.finalCostOfr' : 'cnt.finalCost';

    const qb = invManager
      .getRepository(InventoryCount)
      .createQueryBuilder('cnt')
      .select(`COALESCE(${qtyField},0)`, 'qty')
      .addSelect(`COALESCE(${costField},0)`, 'cost')
      .where('cnt.itemVariantId IN (:...ids)', { ids });

    const rows = (await qb.getRawMany()) as Array<{ qty: any; cost: any }>;

    const qty = rows.reduce((s, r) => s + num(r.qty, 0), 0);
    const wsum = rows.reduce((s, r) => s + num(r.qty, 0) * num(r.cost, 0), 0);
    const avg = qty > 0 ? wsum / qty : 0;

    return { qty, avg };
  }

  // ────────────────────────────────────────────────────────────
  // “last event” support (purchase/transfer/count)
  // ────────────────────────────────────────────────────────────
  private async getLastTxBefore(
    variantIds: number[],
    cutoff: Date,
    currPiiIds: number[],
  ) {
    const ids = this.uniqNums(variantIds);
    if (!ids.length) return null;

    const qb = this.inventoryTxRepo
      .createQueryBuilder('tx')
      .where('tx.itemVariantId IN (:...ids)', { ids })
      .andWhere('tx.dateForEachInvoice < :cut', { cut: cutoff });

    if (currPiiIds.length) {
      qb.andWhere(
        '(tx.purchaseInvoiceItemId IS NULL OR tx.purchaseInvoiceItemId NOT IN (:...currIds))',
        { currIds: currPiiIds },
      );
    }

    // prefer dateForEachInvoice then id
    qb.orderBy('tx.dateForEachInvoice', 'DESC').addOrderBy('tx.id', 'DESC').limit(1);

    return (await qb.getOne()) ?? null;
  }

  private async getCountCostById(
    invManager: EntityManager,
    countId: number,
    chain: Chain,
  ) {
    if (!countId) return 0;
    const cnt = await invManager.getRepository(InventoryCount).findOne({ where: { id: countId } as any });
    if (!cnt) return 0;
    return chain === 'OFR' ? num((cnt as any).finalCostOfr, 0) : num((cnt as any).finalCost, 0);
  }

  // ────────────────────────────────────────────────────────────
  // Resolve prev for VARIANT (avgCost / avgCostVM)
  // - prevQty: tx sum (fallback to counts only when no tx rows)
  // - prevAvg: depends on LAST EVENT
  // ────────────────────────────────────────────────────────────
  private async resolvePrevVariant(
    invManager: EntityManager,
    variantId: number,
    chain: Chain,
    avgField: 'averageCost' | 'averageCostVM',
    dayStart: Date,
    currPiiIds: number[],
    useQtyCol = false,
  ) {
    const ids = [variantId];

    // qty
    const { sum: txSum, txCount } = await this.sumTxQtyDetailed(ids, chain, dayStart, currPiiIds, useQtyCol);
    let prevQty = txSum;

    if (txCount === 0) {
      prevQty = await this.countFallbackPrevQty(invManager, ids, chain);
    }
    prevQty = this.clampPrevQty(prevQty);

    // last event
    const lastTx = await this.getLastTxBefore(ids, dayStart, currPiiIds);

    // avg
    let prevAvg = 0;

    if (lastTx?.transactionType === 'purchase') {
      // take avg from latest previous PO row
      const prev = (await this.itemRepo
        .createQueryBuilder('pii')
        .innerJoin('pii.invoice', 'inv')
        .where('pii.itemVariantId = :vid', { vid: variantId })
        .andWhere('inv.status = :st', { st: 'Recieved' })
        .andWhere('inv.date < :cut', { cut: dayStart })
        .andWhere(`pii.${avgField} IS NOT NULL`)
        .orderBy('inv.date', 'DESC')
        .addOrderBy('pii.id', 'DESC')
        .select([`pii.${avgField} AS avg`])
        .getRawOne()) as { avg?: string | number | null } | undefined;

      prevAvg = prev?.avg != null ? num(prev.avg, 0) : 0;
    } else if (lastTx?.inventoryCountId) {
      // last event is a COUNT -> use that count cost
      prevAvg = await this.getCountCostById(invManager, Number(lastTx.inventoryCountId), chain);
    } else {
      // transfer/other -> use stored current averages on ItemVariant
      const v = await this.variantRepo.findOne({
        where: { id: variantId } as any,
        select: ['id', 'averageCost', 'averageCostVM'] as any,
      });
      prevAvg = chain === 'OFR' ? num((v as any)?.averageCost, 0) : num((v as any)?.averageCostVM, 0);

      // if still empty, fallback to openings weighted avg
      if (!prevAvg) {
        const open = await this.openingsWeightedAvg(invManager, ids, chain);
        prevAvg = open.avg;
      }
    }

    return { prevQty, prevAvg };
  }

  // ────────────────────────────────────────────────────────────
  // Resolve prev for DESCRIPTION (avgCostC / avgCostCVM)
  // - prevQty: tx sum over all variants in desc (fallback to counts only when no tx rows)
  // - prevAvg: depends on LAST EVENT (purchase/count/transfer)
  // ────────────────────────────────────────────────────────────
  private async resolvePrevDesc(
    invManager: EntityManager,
    descId: number,
    variantIdsForDesc: number[],
    chain: Chain,
    avgField: 'averageCostC' | 'averageCostCVM',
    dayStart: Date,
    currPiiIds: number[],
  ) {
    const ids = this.uniqNums(variantIdsForDesc);
    if (!ids.length) return { prevQty: 0, prevAvg: 0 };

    const { sum: txSum, txCount } = await this.sumTxQtyDetailed(ids, chain, dayStart, currPiiIds);
    let prevQty = txSum;
    if (txCount === 0) {
      prevQty = await this.countFallbackPrevQty(invManager, ids, chain);
    }
    prevQty = this.clampPrevQty(prevQty);

    const lastTx = await this.getLastTxBefore(ids, dayStart, currPiiIds);

    let prevAvg = 0;

    if (lastTx?.transactionType === 'purchase') {
      const prev = (await this.itemRepo
        .createQueryBuilder('pii')
        .innerJoin('pii.invoice', 'inv')
        .innerJoin('pii.itemVariant', 'iv')
        .where('inv.status = :st', { st: 'Recieved' })
        .andWhere('inv.date < :cut', { cut: dayStart })
        .andWhere('iv.itemNameDescriptionId = :descId', { descId })
        .andWhere(`pii.${avgField} IS NOT NULL`)
        .orderBy('inv.date', 'DESC')
        .addOrderBy('pii.id', 'DESC')
        .select([`pii.${avgField} AS avg`])
        .getRawOne()) as { avg?: string | number | null } | undefined;

      prevAvg = prev?.avg != null ? num(prev.avg, 0) : 0;
    } else if (lastTx?.inventoryCountId) {
      // last event is COUNT -> use openings weighted avg for the desc (more stable than 1 row)
      const open = await this.openingsWeightedAvg(invManager, ids, chain);
      prevAvg = open.avg;
    } else {
      // transfer/other -> use stored current averages on ItemNameDescription
      const d = await this.descRepo.findOne({
        where: { id: descId } as any,
        select: ['id', 'averageCostC', 'averageCostCVM'] as any,
      });
      prevAvg =
        chain === 'OFR'
          ? num((d as any)?.averageCostC, 0)
          : num((d as any)?.averageCostCVM, 0);

      if (!prevAvg) {
        const open = await this.openingsWeightedAvg(invManager, ids, chain);
        prevAvg = open.avg;
      }
    }

    return { prevQty, prevAvg };
  }

  // ────────────────────────────────────────────────────────────
  // Compute + write averages ONLY for this invoice (NO RECOMPUTE CHAIN)
  // ────────────────────────────────────────────────────────────
  private async computeAndWriteCostsForInvoice(invoiceId: number) {
    const savedInvoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId } as any,
      relations: ['items'],
    });
    if (!savedInvoice) return;
    if (savedInvoice.status !== 'Recieved') return;

    const invDate = new Date(savedInvoice.date);
    const dayStart = this.startOfDay(invDate);

    const items = savedInvoice.items ?? [];
    if (!items.length) return;

    const currPiiIds = items
      .map((i: any) => Number(i.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    const invManager = this.inventoryTxRepo.manager;

    // Map variant -> descId for grouping
    const itemVariantIds = this.uniqNums(items.map((i: any) => i.itemVariantId));
    const variantRows = itemVariantIds.length
      ? await this.variantRepo.find({
          where: { id: In(itemVariantIds) } as any,
          select: ['id', 'itemNameDescriptionId'] as any,
        })
      : [];

    const variantToDesc = new Map<number, number | null>(
      variantRows.map((v: any) => [Number(v.id), v.itemNameDescriptionId ?? null]),
    );

    // Detect unit items (stockMode=QTY or type=unit) — they use quantity, not sqm, as weight
    const unitVariantSet = new Set<number>();
    if (itemVariantIds.length) {
      const unitRows: { vid: number }[] = await this.variantRepo
        .createQueryBuilder('v')
        .innerJoin('v.thickness', 't')
        .innerJoin('t.item', 'i')
        .select('v.id', 'vid')
        .where('v.id IN (:...ids)', { ids: itemVariantIds })
        .andWhere("(i.stockMode = 'QTY' OR i.type = 'unit')")
        .getRawMany();
      for (const r of unitRows) unitVariantSet.add(Number(r.vid));
    }

    const itemsByDesc = new Map<number, PurchaseInvoiceItem[]>();
    for (const it of items) {
      const descId = variantToDesc.get(Number((it as any).itemVariantId));
      if (descId == null) continue;
      if (!itemsByDesc.has(descId)) itemsByDesc.set(descId, []);
      itemsByDesc.get(descId)!.push(it as any);
    }
    const descIds = Array.from(itemsByDesc.keys());

    // A) per-variant (averageCost / averageCostVM)
    for (const it of items) {
      const vid = Number((it as any).itemVariantId);
      if (!Number.isFinite(vid) || vid <= 0) continue;

      const isUnit = unitVariantSet.has(vid);

      const prevOfr = await this.resolvePrevVariant(
        invManager,
        vid,
        'OFR',
        'averageCost',
        dayStart,
        currPiiIds,
        isUnit,
      );
      const prevVm = await this.resolvePrevVariant(
        invManager,
        vid,
        'VM',
        'averageCostVM',
        dayStart,
        currPiiIds,
        isUnit,
      );

      // Unit items: weight = pieces (quantity), cost = totalOFR / quantity
      // Tile items: weight = sqm (sqmOfr),     cost = finalOFR (per sqm)
      const poQtyOfr  = isUnit ? num((it as any).quantity) : getItemQty(it, 'OFR');
      const poCostOfr = isUnit
        ? (num((it as any).quantity) > 0 ? num((it as any).totalOFR) / num((it as any).quantity) : 0)
        : getItemCost(it, 'OFR');
      const poQtyVm  = isUnit ? num((it as any).quantity) : getItemQty(it, 'VM');
      const poCostVm = isUnit
        ? (num((it as any).quantity) > 0 ? num((it as any).totalAmount) / num((it as any).quantity) : 0)
        : getItemCost(it, 'VM');

      const totalOfr = prevOfr.prevQty + poQtyOfr;
      const newAvgOfr =
        totalOfr > 0
          ? (prevOfr.prevAvg * prevOfr.prevQty + poCostOfr * poQtyOfr) / totalOfr
          : prevOfr.prevAvg;

      const totalVm = prevVm.prevQty + poQtyVm;
      const newAvgVm =
        totalVm > 0
          ? (prevVm.prevAvg * prevVm.prevQty + poCostVm * poQtyVm) / totalVm
          : prevVm.prevAvg;

      await this.itemRepo.update((it as any).id, {
        previousQuantity: prevOfr.prevQty,
        previousAverageCost: prevOfr.prevAvg,
        averageCost: newAvgOfr,

        previousQuantityVM: prevVm.prevQty,
        previousAverageCostVM: prevVm.prevAvg,
        averageCostVM: newAvgVm,
      } as any);

      await this.variantRepo.update(vid, {
        averageCost: newAvgOfr,
        lastCost: poCostOfr,

        averageCostVM: newAvgVm,
        lastCostVM: poCostVm,
      } as any);
    }

    // B) per-description (averageCostC / averageCostCVM) on ItemNameDescription
    for (const descId of descIds) {
      const rows = itemsByDesc.get(descId) ?? [];
      if (!rows.length) continue;

      const variantIdsForDesc = (
        await this.variantRepo.find({
          where: { itemNameDescriptionId: descId } as any,
          select: ['id'] as any,
        })
      )
        .map((v: any) => Number(v.id))
        .filter((n) => Number.isFinite(n) && n > 0);

      if (!variantIdsForDesc.length) continue;

      // OFR (C)
      const prevC = await this.resolvePrevDesc(
        invManager,
        descId,
        variantIdsForDesc,
        'OFR',
        'averageCostC',
        dayStart,
        currPiiIds,
      );

      const poQtyC = rows.reduce((s, r) => s + getItemQty(r, 'OFR'), 0);
      const poWsumC = rows.reduce(
        (s, r) => s + getItemQty(r, 'OFR') * getItemCost(r, 'OFR'),
        0,
      );
      const poCostC = poQtyC > 0 ? poWsumC / poQtyC : 0;

      const totalC = prevC.prevQty + poQtyC;
      const newAvgC =
        totalC > 0 ? (prevC.prevAvg * prevC.prevQty + poCostC * poQtyC) / totalC : prevC.prevAvg;

      // VM (CVM)
      const prevCvm = await this.resolvePrevDesc(
        invManager,
        descId,
        variantIdsForDesc,
        'VM',
        'averageCostCVM',
        dayStart,
        currPiiIds,
      );

      const poQtyCVM = rows.reduce((s, r) => s + getItemQty(r, 'VM'), 0);
      const poWsumCVM = rows.reduce(
        (s, r) => s + getItemQty(r, 'VM') * getItemCost(r, 'VM'),
        0,
      );
      const poCostCVM = poQtyCVM > 0 ? poWsumCVM / poQtyCVM : 0;

      const totalCVM = prevCvm.prevQty + poQtyCVM;
      const newAvgCVM =
        totalCVM > 0
          ? (prevCvm.prevAvg * prevCvm.prevQty + poCostCVM * poQtyCVM) / totalCVM
          : prevCvm.prevAvg;

      // write to rows (PurchaseInvoiceItem history fields)
      for (const r of rows) {
        await this.itemRepo.update((r as any).id, {
          previousQuantityC: prevC.prevQty,
          previousAverageCostC: prevC.prevAvg,
          averageCostC: newAvgC,

          previousQuantityCVM: prevCvm.prevQty,
          previousAverageCostCVM: prevCvm.prevAvg,
          averageCostCVM: newAvgCVM,
        } as any);
      }

      // mirror to ItemNameDescription (C/CVM live values)
      await this.descRepo.update(descId, {
        averageCostC: newAvgC,
        averageCostCVM: newAvgCVM,
        lastCostC: poCostC,
        lastCostCVM: poCostCVM,
      } as any);
    }
  }

  // ────────────────────────────────────────────────────────────
  // inventory rebuild (kept from your logic; typed fixes applied)
  // ────────────────────────────────────────────────────────────
  private async rebuildInventoryForPurchaseInvoice(
    savedInvoice: PurchaseInvoice,
    extraBatchIds: number[] = [],
  ): Promise<void> {
    if (!savedInvoice) return;

    const isPosted = savedInvoice.status === 'Recieved';
    const items = (savedInvoice as any).items ?? [];
    if (!items.length && !extraBatchIds.length) return;

    const invoiceDate = new Date(savedInvoice.date);

    // 0) remove old tx rows for this invoice items (caller already did delete; safe anyway)
    const itemIds = items.map((it: any) => Number(it.id)).filter((n: number) => Number.isFinite(n) && n > 0);

    const existingTxs = itemIds.length
      ? await this.inventoryTxRepo.find({ where: { purchaseInvoiceItemId: In(itemIds) } as any })
      : [];

    const batchIdByItemId = new Map<number, number>();
    for (const tx of existingTxs) {
      if ((tx as any).purchaseInvoiceItemId && (tx as any).itemBatchId) {
        batchIdByItemId.set(Number((tx as any).purchaseInvoiceItemId), Number((tx as any).itemBatchId));
      }
    }

    if (existingTxs.length) {
      await this.inventoryTxRepo.delete({ purchaseInvoiceItemId: In(itemIds) } as any);
    }

    const invTxs: InventoryTransaction[] = [];

    // 1) recreate tx rows if posted
    if (isPosted && items.length) {
      for (const item of items) {
        const itemId = Number((item as any).id);
        let existingBatchId = batchIdByItemId.get(itemId) ?? null;

        // Verify the old batch's warehouse still matches; if warehouse changed, don't reuse it
        const invoiceWarehouse = (savedInvoice as any).warehouse ?? 'Shamoun';
        if (existingBatchId) {
          const oldBatch = await this.itemBatchRepo.findOne({ where: { id: existingBatchId } as any });
          if (!oldBatch || (oldBatch as any).warehouse !== invoiceWarehouse) {
            existingBatchId = null;
          }
        }

        if (!existingBatchId) {
          const condition = (item as any).condition || 'Clean';
          const fallbackBatch = await this.itemBatchRepo.findOne({
            where: {
              itemVariant: { id: Number((item as any).itemVariantId) },
              condition,
              dateReceived: null,
              warehouse: invoiceWarehouse,
            } as any,
          });

          if (fallbackBatch) {
            existingBatchId = fallbackBatch.id;
          } else {
            // No batch exists for this warehouse yet — create one (e.g. warehouse changed on edit)
            const newBatch = this.itemBatchRepo.create();
            Object.assign(newBatch, {
              itemVariant: { id: Number((item as any).itemVariantId) } as any,
              condition,
              dateReceived: null,
              warehouse: invoiceWarehouse,
              start: 0, in: 0, out: 0, balance: 0,
              startOFR: 0, inOFR: 0, outOFR: 0, balanceOFR: 0,
            });
            const savedBatch = await this.itemBatchRepo.save(newBatch);
            existingBatchId = (savedBatch as any).id;
          }
        }

        const sqmVM = Number((item as any).sqm ?? 0);
        const sqmOFR = Number((item as any).sqmofr ?? (item as any).sqmOfr ?? sqmVM ?? 0);

        const isPR = (savedInvoice as any).type === 'PR';
        const effectiveType = isPR ? ((savedInvoice as any).returnBaseType ?? 'S') : (savedInvoice as any).type;
        const sign = isPR ? -1 : 1;
        const txTransactionType = isPR ? 'purchase return' : 'purchase';

        let qty = sign * Number((item as any).quantity ?? 0);
        let qtyOfr = qty;
        let sqm = sign * sqmVM;
        let sqmofr = sign * sqmOFR;

        switch (effectiveType) {
          case 'S':
          case 'SR':
            qtyOfr = qty;
            sqmofr = sqm;
            break;
          case 'G':
            qtyOfr = qty;
            sqmofr = sign * sqmOFR;
            qty = 0;
            sqm = 0;
            break;
          case 'RVR':
            qtyOfr = 0;
            sqmofr = 0;
            break;
        }

        const tx: InventoryTransaction =
          (this.inventoryTxRepo.create({
            itemVariantId: Number((item as any).itemVariantId),
            itemBatchId: Number(existingBatchId),
            transactionType: txTransactionType,
            quantity: qty,
            sqm: sqm,
            quantityofr: qtyOfr,
            sqmofr: sqmofr,
            finalcost: Number((item as any).finalCost ?? 0),
            finalcostofr: Number((item as any).finalOFR ?? 0),
            purchaseInvoiceItemId: itemId,
            invoiceItemId: null,
            transferId: null,
            inventoryCountId: null,
            dateForEachInvoice: invoiceDate,
          } as any) as any);

        invTxs.push(tx);
      }

      if (invTxs.length) {
        await this.inventoryTxRepo.save(invTxs);
      }
    }

    // 2) recalc batch totals from tx (purchase only)
    const affectedBatchIds = Array.from(
      new Set([
        ...(invTxs.map((tx) => (tx as any).itemBatchId).filter((id) => id != null) as number[]),
        ...extraBatchIds,
      ].map((x) => Number(x))),
    ).filter((n) => Number.isFinite(n) && n > 0);

    const variantIdSet = new Set<number>(
      items
        .map((it: any) => Number(it.itemVariantId))
        .filter((n: number) => Number.isFinite(n) && n > 0),
    );

    for (const batchId of affectedBatchIds) {
      const batch = await this.itemBatchRepo.findOne({
        where: { id: batchId } as any,
        relations: ['itemVariant'],
      });
      if (!batch) continue;

      const variantIdFromBatch =
        (batch as any).itemVariantId ?? (batch.itemVariant ? Number((batch.itemVariant as any).id) : null);
      if (Number.isFinite(variantIdFromBatch) && Number(variantIdFromBatch) > 0) {
        variantIdSet.add(Number(variantIdFromBatch));
      }

      const agg = await this.inventoryTxRepo
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.sqm), 0)', 'sumSqm')
        .addSelect('COALESCE(SUM(tx.sqmofr), 0)', 'sumSqmOfr')
        .where('tx.itemBatchId = :batchId', { batchId })
        .andWhere('tx.transactionType IN (:...txTypes)', { txTypes: ['purchase', 'purchase return'] })
        .getRawOne<{ sumSqm: string; sumSqmOfr: string }>();

      const inSqm = Number(agg?.sumSqm ?? 0);
      const inSqmOFR = Number(agg?.sumSqmOfr ?? 0);

      (batch as any).in = parseFloat(inSqm.toFixed(4));
      (batch as any).inOFR = parseFloat(inSqmOFR.toFixed(4));

      (batch as any).balance = parseFloat(
        (Number((batch as any).start ?? 0) + Number((batch as any).in ?? 0) - Number((batch as any).out ?? 0)).toFixed(4),
      );
      (batch as any).balanceOFR = parseFloat(
        (Number((batch as any).startOFR ?? 0) + Number((batch as any).inOFR ?? 0) - Number((batch as any).outOFR ?? 0)).toFixed(4),
      );

      await this.itemBatchRepo.save(batch);
    }

    // 3) recalc itemVariant totals from batches
    const affectedVariantIds = Array.from(variantIdSet);

    for (const variantId of affectedVariantIds) {
      const variant = await this.variantRepo.findOne({
        where: { id: variantId } as any,
        relations: ['batches'],
      });
      if (!variant) continue;

      let totalStart = 0,
        totalIn = 0,
        totalOut = 0;
      let totalStartOFR = 0,
        totalInOFR = 0,
        totalOutOFR = 0;

      for (const b of (variant as any).batches || []) {
        totalStart += Number((b as any).start ?? 0);
        totalIn += Number((b as any).in ?? 0);
        totalOut += Number((b as any).out ?? 0);

        totalStartOFR += Number((b as any).startOFR ?? 0);
        totalInOFR += Number((b as any).inOFR ?? 0);
        totalOutOFR += Number((b as any).outOFR ?? 0);
      }

      (variant as any).totalStart = parseFloat(totalStart.toFixed(4));
      (variant as any).totalIn = parseFloat(totalIn.toFixed(4));
      (variant as any).totalOut = parseFloat(totalOut.toFixed(4));
      (variant as any).totalBalance = parseFloat((totalStart + totalIn - totalOut).toFixed(4));

      (variant as any).totalStartOFR = parseFloat(totalStartOFR.toFixed(4));
      (variant as any).totalInOFR = parseFloat(totalInOFR.toFixed(4));
      (variant as any).totalOutOFR = parseFloat(totalOutOFR.toFixed(4));
      (variant as any).totalBalanceOFR = parseFloat((totalStartOFR + totalInOFR - totalOutOFR).toFixed(4));

      await this.variantRepo.save(variant);
    }
  }

  // ────────────────────────────────────────────────────────────
  // JV creation (typed fixes applied)
  // ────────────────────────────────────────────────────────────
private async createOrRebuildJVForPurchaseInvoice(
  invoice: PurchaseInvoice,
  items: PurchaseInvoiceItem[],
  unitPriceRows: any[] | undefined,
) {
  if (
    (invoice as any).status !== 'Recieved' ||
    !['G', 'S', 'SR', 'PR'].includes((invoice as any).type as any)
  ) {
    return;
  }

  const isPR = (invoice as any).type === 'PR';
  const effectiveType = isPR ? ((invoice as any).returnBaseType ?? 'S') : (invoice as any).type;

  // Resolve the correct account based on invoice type
  const expenseAcct = await this.accountingResolver.resolveAccount(
    isPR ? 'PurchasesReturn_USD' : 'Purchases_USD',
    null,
  );

  let normalTotal = 0;
  let ofrTotal = 0;

  if (effectiveType === 'G') {
    for (const row of items as any[]) ofrTotal += Number(row.totalOFR ?? 0);
  } else if (effectiveType === 'S') {
    for (const row of items as any[]) {
      normalTotal += Number(row.totalAmount ?? 0);
      ofrTotal += Number(row.totalAmount ?? 0);
    }
  } else {
    for (const row of items as any[]) {
      normalTotal += Number(row.totalAmount ?? 0);
      ofrTotal += Number(row.totalOFR ?? 0);
    }
  }

  const rate = Number((invoice as any).exchangeRate ?? 1);
  const invoiceCurrency = String((invoice as any).currency || 'USD').toUpperCase();
  const normalLL = normalTotal * rate;
  const ofrLL = ofrTotal * rate;

  const jvNumber = (invoice as any).invoiceNumber;

  // Fetch supplier name for JV descriptions
  const invoiceWithSupplier = await this.invoiceRepo.findOne({
    where: { id: (invoice as any).id } as any,
    relations: ['supplier'],
  });
  const supplierName = (invoiceWithSupplier as any)?.supplier?.supplierName || '';
  const supplierInvNb = String((invoice as any).supplierInvoiceNumber || '').trim();
  const hdrDebitDesc = `فاتورة شراء - رقم ${supplierInvNb}${supplierName ? ' - ' + supplierName : ''}`;
  const hdrCreditDesc = `فاتورة شراء - رقم ${supplierInvNb}`;

  let hdrDr = 0,
    hdrDrUSD = 0,
    hdrDrLL = 0;
  let hdrDrOFR = 0,
    hdrDrUSDOFR = 0,
    hdrDrLLOFR = 0;
  let hdrCr = 0,
    hdrCrUSD = 0,
    hdrCrLL = 0;
  let hdrCrOFR = 0,
    hdrCrUSDOFR = 0,
    hdrCrLLOFR = 0;

  if (effectiveType === 'G') {
    hdrDrOFR = ofrTotal;
    hdrDrUSDOFR = ofrTotal;
    hdrDrLLOFR = ofrLL;

    hdrCrOFR = ofrTotal;
    hdrCrUSDOFR = ofrTotal;
    hdrCrLLOFR = ofrLL;
  } else if (effectiveType === 'S') {
    hdrDr = normalTotal;
    hdrDrUSD = normalTotal;
    hdrDrLL = normalLL;
    hdrDrOFR = normalTotal;
    hdrDrUSDOFR = normalTotal;
    hdrDrLLOFR = normalLL;

    hdrCr = normalTotal;
    hdrCrUSD = normalTotal;
    hdrCrLL = normalLL;
    hdrCrOFR = normalTotal;
    hdrCrUSDOFR = normalTotal;
    hdrCrLLOFR = normalLL;
  } else {
    hdrDr = normalTotal;
    hdrDrUSD = normalTotal;
    hdrDrLL = normalLL;
    hdrDrOFR = ofrTotal;
    hdrDrUSDOFR = ofrTotal;
    hdrDrLLOFR = ofrLL;

    hdrCr = normalTotal;
    hdrCrUSD = normalTotal;
    hdrCrLL = normalLL;
    hdrCrOFR = ofrTotal;
    hdrCrUSDOFR = ofrTotal;
    hdrCrLLOFR = ofrLL;
  }

  // Apply VAT percentage to both the purchases DR and supplier CR lines
  const vatPct = Number((invoice as any).vatPercent ?? 0);
  if (vatPct > 0) {
    let vatNormal = 0, vatOFR = 0;
    if (effectiveType === 'G') {
      vatOFR = ofrTotal * (vatPct / 100);
    } else if (effectiveType === 'S') {
      vatNormal = normalTotal * (vatPct / 100);
      vatOFR = normalTotal * (vatPct / 100);
    } else {
      vatNormal = normalTotal * (vatPct / 100);
      vatOFR = ofrTotal * (vatPct / 100);
    }
    const vatNormalLL = vatNormal * rate;
    const vatOFRLL = vatOFR * rate;

    hdrDr += vatNormal;      hdrDrUSD += vatNormal;      hdrDrLL += vatNormalLL;
    hdrDrOFR += vatOFR;     hdrDrUSDOFR += vatOFR;     hdrDrLLOFR += vatOFRLL;
    hdrCr += vatNormal;      hdrCrUSD += vatNormal;      hdrCrLL += vatNormalLL;
    hdrCrOFR += vatOFR;     hdrCrUSDOFR += vatOFR;     hdrCrLLOFR += vatOFRLL;
  }

  // For PR (purchase return): DR side is supplier (reduces payable), CR side is expense account
  const debitAccountId = isPR ? null : (expenseAcct as any).id;
  const debitSupplierId = isPR ? (invoice as any).supplierId : null;
  const creditAccountId = isPR ? (expenseAcct as any).id : null;
  const creditSupplierId = isPR ? null : (invoice as any).supplierId;

const debitLine = this.journalVoucherDetailRepo.create(
  {
    accountId: debitAccountId,
    supplierId: debitSupplierId,
    description: hdrDebitDesc,
    docNbr: jvNumber,
    currency: invoiceCurrency,
    exRateUSD: rate,

    dr: hdrDr,
    drUSD: hdrDrUSD,
    drLL: hdrDrLL,
    drOFR: hdrDrOFR,
    drUSDOFR: hdrDrUSDOFR,
    drLLOFR: hdrDrLLOFR,

    cr: 0,
    crUSD: 0,
    crLL: 0,
    crOFR: 0,
    crUSDOFR: 0,
    crLLOFR: 0,

    exchangeRateAcc: null,
    exchangeRateUSD: null,
  } as DeepPartial<JournalVoucherDetail>,
);

const creditLine = this.journalVoucherDetailRepo.create(
  {
    accountId: creditAccountId,
    supplierId: creditSupplierId,
    description: hdrCreditDesc,
    docNbr: jvNumber,
    currency: invoiceCurrency,
    exRateUSD: rate,

    dr: 0,
    drUSD: 0,
    drLL: 0,
    drOFR: 0,
    drUSDOFR: 0,
    drLLOFR: 0,

    cr: hdrCr,
    crUSD: hdrCrUSD,
    crLL: hdrCrLL,
    crOFR: hdrCrOFR,
    crUSDOFR: hdrCrUSDOFR,
    crLLOFR: hdrCrLLOFR,

    exchangeRateAcc: null,
    exchangeRateUSD: null,
  } as DeepPartial<JournalVoucherDetail>,
);


  const extraJVDetails: JournalVoucherDetail[] = [];

  if (unitPriceRows?.length) {
    type CreditGroup = {
      creditAccountId: number | null;
      creditSupplierId: number | null;
      cr: number; crUSD: number; crLL: number;
      crOFR: number; crUSDOFR: number; crLLOFR: number;
    };
    const creditGroups = new Map<string, CreditGroup>();

    for (const row of unitPriceRows as any[]) {
      // Resolve charge account and tax (supplier of tax) fields
      const chargeAccountId: number | null = row.accountId ?? row.account?.id ?? null;

      const taxAccountId: number | null =
        row.taxAccountId != null ? Number(row.taxAccountId)
        : row.taxAccount?.id != null ? Number(row.taxAccount.id)
        : null;

      const taxSupplierId: number | null =
        row.taxSupplierId != null ? Number(row.taxSupplierId)
        : row.taxSupplier?.id != null ? Number(row.taxSupplier.id)
        : null;

      const creditAccountId: number | null = taxAccountId;
      const creditSupplierId: number | null = creditAccountId ? null : (taxSupplierId ?? null);

      // Skip row if charge account or supplier of tax is missing
      if (!chargeAccountId || (creditAccountId == null && creditSupplierId == null)) {
        continue;
      }

      const value = Number(row.value || 0);
      const valueOFR = Number(row.valueOFR || 0);
      const valueLL = value * rate;
      const valueOFRLL = valueOFR * rate;

      let dr = 0, drUSD = 0, drLL = 0, drOFR = 0, drUSDOFR = 0, drLLOFR = 0;
      let cr = 0, crUSD = 0, crLL = 0, crOFR = 0, crUSDOFR = 0, crLLOFR = 0;

      if (effectiveType === 'G') {
        drOFR = valueOFR; drUSDOFR = valueOFR; drLLOFR = valueOFRLL;
        crOFR = valueOFR; crUSDOFR = valueOFR; crLLOFR = valueOFRLL;
      } else if (effectiveType === 'S') {
        dr = value; drUSD = value; drLL = valueLL;
        drOFR = value; drUSDOFR = value; drLLOFR = valueLL;
        cr = value; crUSD = value; crLL = valueLL;
        crOFR = value; crUSDOFR = value; crLLOFR = valueLL;
      } else if (effectiveType === 'SR') {
        dr = value; drUSD = value; drLL = valueLL;
        drOFR = valueOFR; drUSDOFR = valueOFR; drLLOFR = valueOFRLL;
        cr = value; crUSD = value; crLL = valueLL;
        crOFR = valueOFR; crUSDOFR = valueOFR; crLLOFR = valueOFRLL;
      }

      // One debit line per charge row
      const rowChargeName = String(row.chargeName || '').trim();
      const rowNbTax = String(row.invoiceNbTax || '').trim();
      const debitDesc = ['Expense invoice', rowChargeName, rowNbTax].filter(Boolean).join(' - ');

      const drLine = this.journalVoucherDetailRepo.create({
        accountId: chargeAccountId,
        description: debitDesc,
        docNbr: jvNumber,
        currency: invoiceCurrency,
        exRateUSD: rate,
        dr, drUSD, drLL, drOFR, drUSDOFR, drLLOFR,
        cr: 0, crUSD: 0, crLL: 0, crOFR: 0, crUSDOFR: 0, crLLOFR: 0,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      } as DeepPartial<JournalVoucherDetail>);

      extraJVDetails.push(drLine);

      // Group credit lines: key includes nbTax only when it is present
      const groupKey = rowNbTax
        ? `${rowNbTax}|${creditAccountId ?? ''}|${creditSupplierId ?? ''}`
        : `|${creditAccountId ?? ''}|${creditSupplierId ?? ''}`;

      if (creditGroups.has(groupKey)) {
        const g = creditGroups.get(groupKey)!;
        g.cr += cr; g.crUSD += crUSD; g.crLL += crLL;
        g.crOFR += crOFR; g.crUSDOFR += crUSDOFR; g.crLLOFR += crLLOFR;
      } else {
        creditGroups.set(groupKey, {
          creditAccountId, creditSupplierId,
          cr, crUSD, crLL, crOFR, crUSDOFR, crLLOFR,
        });
      }
    }

    // One credit line per group (summed)
    for (const [, g] of creditGroups) {
      const crLine = this.journalVoucherDetailRepo.create({
        accountId: g.creditAccountId,
        supplierId: g.creditSupplierId,
        description: 'Payable invoice',
        docNbr: jvNumber,
        currency: invoiceCurrency,
        exRateUSD: rate,
        dr: 0, drUSD: 0, drLL: 0, drOFR: 0, drUSDOFR: 0, drLLOFR: 0,
        cr: g.cr, crUSD: g.crUSD, crLL: g.crLL,
        crOFR: g.crOFR, crUSDOFR: g.crUSDOFR, crLLOFR: g.crLLOFR,
        exchangeRateAcc: null,
        exchangeRateUSD: null,
      } as DeepPartial<JournalVoucherDetail>);

      extraJVDetails.push(crLine);
    }
  }

  const jv = this.journalVoucherRepo.create({
    jvNumber,
    purchaseInvoiceId: (invoice as any).id,
    date: (invoice as any).jvDate,
    jvType: isPR ? 'PR' : (invoice as any).type,

    totalDr: hdrDr,
    totalDrUSD: hdrDrUSD,
    totalDrLL: hdrDrLL,
    totalDrOFR: hdrDrOFR,
    totalDrUSDOFR: hdrDrUSDOFR,
    totalDrLLOFR: hdrDrLLOFR,

    totalCr: hdrCr,
    totalCrUSD: hdrCrUSD,
    totalCrLL: hdrCrLL,
    totalCrOFR: hdrCrOFR,
    totalCrUSDOFR: hdrCrUSDOFR,
    totalCrLLOFR: hdrCrLLOFR,

    exchangeRateAcc: null,
    exchangeRateUSD: null,

    details: [debitLine, creditLine, ...extraJVDetails],
  } as any);

  await this.journalVoucherRepo.save(jv);
}





  private async getActiveYearYY(): Promise<string> {
  const setting = await this.settingsRepo.findOne({ where: { isActive: true } as any });
  if (!setting?.year) throw new Error('Active year not found in settings');
  return String(setting.year).slice(-2);
}

// getNextPurchaseInvoiceNumber() reads MAX(invoiceNumber)+1 with no
// row-level locking — under real concurrency (e.g. two invoices on the same
// vessel both auto-promoting to Recieved around the same tracking-sync
// moment) two calls can read the same "next" number before either commits,
// crashing the second save with a duplicate-key error and leaving that
// invoice stuck at its old status. Retrying with a freshly recomputed
// number on that specific collision is simpler and safer here than
// restructuring this to a locked sequence table, since invoiceNumber is the
// only thing ever raced on and the JV rebuild that depends on it only runs
// after this save succeeds.
private async saveInvoiceAssigningNumberIfNeeded(
  invoice: PurchaseInvoice,
  opts: { needsNewNumber: boolean; type: 'S' | 'G' | 'SR' | 'RVR' },
  maxAttempts = 5,
): Promise<PurchaseInvoice> {
  if (!opts.needsNewNumber) {
    return this.invoiceRepo.save(invoice as any);
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    (invoice as any).invoiceNumber = await this.getNextPurchaseInvoiceNumber(opts.type);
    try {
      return await this.invoiceRepo.save(invoice as any);
    } catch (err: any) {
      const code = err?.code ?? err?.driverError?.code;
      if (code !== 'ER_DUP_ENTRY' || attempt === maxAttempts) throw err;
      this.logger.warn(
        `Purchase invoice number collision (attempt ${attempt}/${maxAttempts}) on ${(invoice as any).invoiceNumber} — retrying with a fresh number.`,
      );
    }
  }
  throw new Error('Failed to assign a unique purchase invoice number after retries.');
}

private async getNextPurchaseInvoiceNumber(type: 'S' | 'G' | 'SR' | 'RVR'): Promise<string> {
  const yy = await this.getActiveYearYY();

  // If you want G to have its own series, keep PVG. If you want ALL types to be PV, replace with: `PV${yy}-`
  const prefix = type === 'G' ? `PVG${yy}-` : `PV${yy}-`;

  const last = await this.invoiceRepo
    .createQueryBuilder('pi')
    .select(['pi.id', 'pi.invoiceNumber'])
    .where('pi.invoiceNumber LIKE :p', { p: `${prefix}%` })
    // Ordered by the number itself, not id — numbers are assigned when an
    // invoice reaches Recieved, which can happen out of creation order (two
    // invoices promoted around the same time via async tracking syncs), so
    // whichever row has the highest id isn't reliably the one with the
    // highest sequence number. Same-width zero-padded prefix means string
    // DESC order matches numeric order.
    .orderBy('pi.invoiceNumber', 'DESC')
    .getOne();

  let lastSeq = 0;
  if (last?.invoiceNumber?.startsWith(prefix)) {
    const part = last.invoiceNumber.replace(prefix, ''); // "001"
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) lastSeq = n;
  }

  const nextSeq = lastSeq + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`; // PV25-001
}

// Independent sequence for invoices that haven't been Recieved yet — same
// shape as getNextPurchaseInvoiceNumber but its own prefix/counter, so it
// never collides with (or consumes from) the PV/PVG series.
private async getNextOrderNumber(): Promise<string> {
  const yy = await this.getActiveYearYY();
  const prefix = `ORD${yy}-`;

  const last = await this.invoiceRepo
    .createQueryBuilder('pi')
    .select(['pi.id', 'pi.orderNumber'])
    .where('pi.orderNumber LIKE :p', { p: `${prefix}%` })
    .orderBy('pi.orderNumber', 'DESC')
    .getOne();

  let lastSeq = 0;
  if ((last as any)?.orderNumber?.startsWith(prefix)) {
    const part = (last as any).orderNumber.replace(prefix, '');
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) lastSeq = n;
  }

  const nextSeq = lastSeq + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`; // ORD25-001
}

// Own sequence for invoices starting at Proforma — separate from
// orderNumber/invoiceNumber, same shape as getNextOrderNumber.
private async getNextProformaNumber(): Promise<string> {
  const yy = await this.getActiveYearYY();
  const prefix = `PRO${yy}-`;

  const last = await this.invoiceRepo
    .createQueryBuilder('pi')
    .select(['pi.id', 'pi.proformaNumber'])
    .where('pi.proformaNumber LIKE :p', { p: `${prefix}%` })
    .orderBy('pi.proformaNumber', 'DESC')
    .getOne();

  let lastSeq = 0;
  if ((last as any)?.proformaNumber?.startsWith(prefix)) {
    const part = (last as any).proformaNumber.replace(prefix, '');
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) lastSeq = n;
  }

  const nextSeq = lastSeq + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`; // PRO25-001
}

  // ────────────────────────────────────────────────────────────
  // CREATE (no recompute functions, no applyPurchaseCostsForInvoice)
  // ────────────────────────────────────────────────────────────
async create(data: Partial<PurchaseInvoice>) {
  const type = (data as any).type ?? 'S';
  (data as any).supplierInvoiceNumber = (data as any).invoiceNumber ?? null;

  // The real PV/PVG purchase-invoice number is reserved for invoices that
  // have actually been Recieved. Before that: Proforma-status invoices get
  // their own PRO number (see getNextProformaNumber); anything else not yet
  // Recieved (created directly as Ordered/Shipped) gets an ORD order number
  // instead (see getNextOrderNumber). Either way, only promoted to a PV
  // number in update() when it reaches Recieved.
  const needsNewInvoiceNumber = (data as any).status === 'Recieved';
  if (needsNewInvoiceNumber) {
    (data as any).invoiceNumber = null;
  } else if ((data as any).status === 'Proforma') {
    (data as any).proformaNumber = await this.getNextProformaNumber();
    (data as any).invoiceNumber = null;
  } else {
    (data as any).orderNumber = await this.getNextOrderNumber();
    (data as any).invoiceNumber = null;
  }
  if ((data as any).etd === '' || (data as any).etd === undefined) (data as any).etd = null;

  // 1) save invoice + items
  const invoice = this.invoiceRepo.create(data as any);
  const savedInvoice = await this.saveInvoiceAssigningNumberIfNeeded(invoice as any, {
    needsNewNumber: needsNewInvoiceNumber,
    type,
  });

  // 2) record inventory tx + batch updates + variant totals
  if ((savedInvoice as any).status === 'Recieved') {
    const invTxs: InventoryTransaction[] = [];
    const invoiceDate = new Date((savedInvoice as any).date);

    for (const item of (((savedInvoice as any).items ?? []) as any[])) {
      let qty = Number(item.quantity ?? 0);
      let sqm = Number(item.sqm ?? 0);

      let qtyOfr = 0;
      let sqmOfr = 0;

      switch ((savedInvoice as any).type) {
        case 'S':
        case 'SR':
          qtyOfr = qty;
          sqmOfr = sqm;
          break;
        case 'G':
          qtyOfr = qty;
          sqmOfr = Number((item as any).sqmOfr ?? 0);
          qty = 0;
          sqm = 0;
          break;
        case 'RVR':
          qtyOfr = 0;
          sqmOfr = 0;
          break;
        default:
          qtyOfr = qty;
          sqmOfr = sqm;
      }

      const condition = item.condition || 'Clean';
      const dateReceived = null;
      const warehouse = (savedInvoice as any).warehouse ?? 'Shamoun';

      let itemBatch: ItemBatch | null = await this.itemBatchRepo.findOne({
        where: {
          itemVariant: { id: item.itemVariantId },
          condition,
          dateReceived,
          warehouse,
        } as any,
        relations: ['itemVariant'],
      });

      if (!itemBatch) {
        const newBatch = this.itemBatchRepo.create();

        Object.assign(newBatch, {
          itemVariant: { id: item.itemVariantId } as any,
          condition,
          dateReceived: null,
          warehouse,

          start: 0,
          in: 0,
          out: 0,
          balance: 0,

          startOFR: 0,
          inOFR: 0,
          outOFR: 0,
          balanceOFR: 0,
        });

        itemBatch = await this.itemBatchRepo.save(newBatch);
      }

      const tx = this.inventoryTxRepo.create(
        {
          itemVariantId: item.itemVariantId,
          itemBatchId: (itemBatch as any).id,
          transactionType: 'purchase',

          quantity: qty,
          sqm: sqm,
          quantityofr: qtyOfr,
          sqmofr: sqmOfr,

          finalcost: Number(item.finalCost ?? 0),
          finalcostofr: Number(item.finalOFR ?? 0),

          purchaseInvoiceItemId: item.id,
          invoiceItemId: null,
          transferId: null,
          inventoryCountId: null,

          dateForEachInvoice: invoiceDate,
        } as DeepPartial<InventoryTransaction>,
      );

      invTxs.push(tx);
    }

    if (invTxs.length) {
      await this.inventoryTxRepo.save(invTxs);
    }

    // rebuild batches + variant totals based on tx
    await this.rebuildInventoryForPurchaseInvoice(
      { ...(savedInvoice as any), items: (savedInvoice as any).items } as any,
      [],
    );

    // JV
    await this.createOrRebuildJVForPurchaseInvoice(
      savedInvoice as any,
      (((savedInvoice as any).items ?? []) as any),
      (data as any)?.unitPriceRows,
    );

    // ✅ unit price rows (NOW also persists taxAccount / taxSupplier correctly)
    if ((data as any)?.unitPriceRows?.length) {
      const normalized = (data as any).unitPriceRows.map((r: any) => {
        const v = Number(r.value ?? 0);
        const o = Number(r.valueOFR ?? 0);
        const ex = Number(r.valueExch ?? 0);
        const eo = Number(r.valueExchOFR ?? 0);
        return {
          ...r,
          value: v,
          valueOFR: v > 0 && o === 0 ? v : o,
          valueExch: ex,
          valueExchOFR: ex > 0 && eo === 0 ? ex : eo,
        };
      });

      const rowsToSave = normalized.map((row: any) => {
        const accountId =
          row.accountId != null
            ? Number(row.accountId)
            : row.account?.id != null
            ? Number(row.account.id)
            : null;

        const supplierId =
          row.supplierId != null
            ? Number(row.supplierId)
            : row.supplier?.id != null
            ? Number(row.supplier.id)
            : null;

        const taxAccountId =
          row.taxAccountId != null
            ? Number(row.taxAccountId)
            : row.taxAccount?.id != null
            ? Number(row.taxAccount.id)
            : null;

        const taxSupplierId =
          row.taxSupplierId != null
            ? Number(row.taxSupplierId)
            : row.taxSupplier?.id != null
            ? Number(row.taxSupplier.id)
            : null;

        return this.rowRepo.create({
          invoice: { id: (savedInvoice as any).id } as any,
          invoiceId: (savedInvoice as any).id,

          purchaseInvoiceSettingId: row.purchaseInvoiceSettingId ?? null,
          chargeName: row.chargeName,
          chargeType: row.chargeType,
          value: Number(row.value ?? 0),
          valueOFR: Number(row.valueOFR ?? 0),
          currency: row.currency,
          valueExch: Number(row.valueExch ?? 0),
          valueExchOFR: Number(row.valueExchOFR ?? 0),

          addToItemCost: row.addToItemCost,
invoiceNbTax: this.intOrNull(row.invoiceNbTax),
          supplierId,
          accountId,
          shipping: row.shipping,

          // ✅ NEW: SAVE RELATIONS (so FK persists even if taxAccountId property isn't declared)
          taxAccount: taxAccountId ? ({ id: taxAccountId } as any) : null,
          taxSupplier: taxSupplierId ? ({ id: taxSupplierId } as any) : null,
        } as any);
      });

      await this.rowRepo.save(rowsToSave as any);
    }

    // ✅ compute averages ONLY for this invoice
    await this.computeAndWriteCostsForInvoice((savedInvoice as any).id);
  }

  return savedInvoice;
}

  // ────────────────────────────────────────────────────────────
  // Proforma -> Order splitting. A Proforma can be split into several
  // separate orders shipped at different times — this reports each
  // Proforma line's original quantity/sqm alongside however much has
  // already been claimed by earlier orders, so the "Create Order" picker
  // can show what's actually still available per line.
  // ────────────────────────────────────────────────────────────
  async getProformaItemsWithRemaining(proformaId: number) {
    const proforma = await this.invoiceRepo.findOne({
      where: { id: proformaId } as any,
      relations: ['items', 'items.itemVariant', 'items.itemVariant.thickness', 'items.itemVariant.thickness.item'],
    });
    if (!proforma) throw new NotFoundException(`PurchaseInvoice ${proformaId} not found`);
    if ((proforma as any).status !== 'Proforma') {
      throw new BadRequestException(`Invoice ${proformaId} is not a Proforma.`);
    }

    const orders = await this.invoiceRepo.find({
      where: { sourceProformaId: proformaId } as any,
      relations: ['items'],
    });

    // Sum quantity/sqm already claimed per item VARIANT (not per proforma
    // item row id) — editing the proforma deletes and recreates its item
    // rows with fresh ids (see update()), which would orphan an id-based
    // link on every edit. itemVariantId is stable across that, since it
    // identifies the actual item, not a row.
    const claimed = new Map<number, { quantity: number; sqm: number }>();
    for (const order of orders) {
      for (const item of ((order as any).items ?? []) as any[]) {
        const key = item.itemVariantId;
        if (!key) continue;
        const prev = claimed.get(key) ?? { quantity: 0, sqm: 0 };
        claimed.set(key, {
          quantity: prev.quantity + Number(item.quantity || 0),
          sqm: prev.sqm + Number(item.sqm || 0),
        });
      }
    }

    // Same field shape/derivation the main items table already uses (see
    // purchases-invoice.jsx's fullInvoice.items mapping) — itemName/type
    // come off thickness.item, origin/length/width/sheetsPerBox off the
    // variant directly — so the picker reads like the same table, not a
    // different one.
    return ((proforma as any).items ?? []).map((it: any) => {
      const used = claimed.get(it.itemVariantId) ?? { quantity: 0, sqm: 0 };
      const quantity = Number(it.quantity || 0);
      const sqm = Number(it.sqm || 0);
      const variant = it.itemVariant;
      const thicknessRow = variant?.thickness;
      const baseItem = thicknessRow?.item;
      const thicknessNum = Number(thicknessRow?.thickness);
      const thickness = Number.isFinite(thicknessNum) ? thicknessNum : null;

      return {
        proformaItemId: it.id,
        itemVariantId: it.itemVariantId,
        itemName: baseItem?.itemName ?? `Item #${it.itemVariantId}`,
        type: baseItem?.type ?? null,
        origin: variant?.origin ?? null,
        length: variant?.length != null ? Number(variant.length) : null,
        width: variant?.width != null ? Number(variant.width) : null,
        sheetsPerBox: variant?.sheetsPerBox ?? null,
        thickness,
        unitPrice: Number(it.unitPrice || 0),
        sqmOfr: Number(it.sqmOfr || 0),
        totalAmount: Number(it.totalAmount || 0),
        totalOFR: it.totalOFR != null ? Number(it.totalOFR) : null,
        priceOFR: it.priceOFR != null ? Number(it.priceOFR) : null,
        numberOfContainers: it.numberOfContainers ?? null,
        quantity,
        sqm,
        orderedQuantity: used.quantity,
        orderedSqm: used.sqm,
        remainingQuantity: Math.max(0, quantity - used.quantity),
        remainingSqm: Math.max(0, sqm - used.sqm),
      };
    });
  }

  // Spin off an Ordered invoice from a Proforma — the Proforma itself is
  // never touched (no status mutation, nothing recomputed on it); this
  // creates a brand new, separate invoice record with its own orderNumber,
  // containing only the selected lines/quantities, linked back via
  // sourceProformaId (and each item's sourceProformaItemId). A Proforma can
  // have more than one order spun off it — e.g. splitting quantities across
  // shipments — so selections are validated against what's actually still
  // remaining on each line.
  async createOrderFromProforma(
    proformaId: number,
    selections: { proformaItemId: number; quantity: number; sqm: number }[],
  ): Promise<PurchaseInvoice> {
    if (!selections?.length) {
      throw new BadRequestException('Select at least one item to include in the order.');
    }

    const proforma = await this.invoiceRepo.findOne({
      where: { id: proformaId } as any,
      relations: ['items'],
    });
    if (!proforma) throw new NotFoundException(`PurchaseInvoice ${proformaId} not found`);
    if ((proforma as any).status !== 'Proforma') {
      throw new BadRequestException(
        `Invoice ${proformaId} is "${(proforma as any).status}", not Proforma — only a Proforma can be used to create an order.`,
      );
    }

    const remaining = await this.getProformaItemsWithRemaining(proformaId);
    const remainingByItemId = new Map<number, any>(remaining.map((r: any) => [r.proformaItemId, r]));
    const sourceItemsById = new Map(
      (((proforma as any).items ?? []) as any[]).map((it) => [it.id, it]),
    );

    const items = selections.map((sel) => {
      const sourceItem = sourceItemsById.get(sel.proformaItemId);
      if (!sourceItem) {
        throw new BadRequestException(`Proforma has no item ${sel.proformaItemId}.`);
      }
      const avail = remainingByItemId.get(sel.proformaItemId);
      const qty = Number(sel.quantity || 0);
      const sqm = Number(sel.sqm || 0);
      if (qty <= 0 && sqm <= 0) {
        throw new BadRequestException(`Enter a quantity for item ${sel.proformaItemId}.`);
      }
      // Small epsilon for float rounding, not a hard exact-match requirement.
      if (avail && (qty > avail.remainingQuantity + 0.01 || sqm > avail.remainingSqm + 0.01)) {
        throw new BadRequestException(
          `${avail.itemName}: only ${avail.remainingSqm} sqm / ${avail.remainingQuantity} remaining, but ${sqm} sqm / ${qty} was requested.`,
        );
      }

      const unitPrice = Number(sourceItem.unitPrice || 0);
      const priceOFR = sourceItem.priceOFR != null ? Number(sourceItem.priceOFR) : null;

      return {
        itemVariantId: sourceItem.itemVariantId,
        sourceProformaItemId: sourceItem.id,
        quantity: qty,
        sqm,
        sqmOfr: sqm, // no separate OFR-quantity input in the picker; mirrors sqm
        unitPrice,
        totalAmount: Number((unitPrice * sqm).toFixed(2)),
        euroPrice: sourceItem.euroPrice ?? null,
        euroOFRPrice: sourceItem.euroOFRPrice ?? null,
        priceOFR,
        totalOFR: priceOFR != null ? Number((priceOFR * sqm).toFixed(2)) : null,
        numberOfContainers: sourceItem.numberOfContainers ?? null,
      };
    });

    const grandTotal = items.reduce((sum, it) => sum + it.totalAmount, 0);

    const payload: Partial<PurchaseInvoice> = {
      supplierId: (proforma as any).supplierId,
      date: (proforma as any).date,
      poDate: (proforma as any).poDate,
      jvDate: (proforma as any).jvDate,
      expectedArrivalDate: (proforma as any).expectedArrivalDate,
      type: (proforma as any).type,
      returnBaseType: (proforma as any).returnBaseType,
      vatPercent: (proforma as any).vatPercent,
      vatAmount: Number(((Number((proforma as any).vatPercent) || 0) / 100 * grandTotal).toFixed(2)),
      grandAmount: grandTotal,
      exchangeRate: (proforma as any).exchangeRate,
      shippingLine: (proforma as any).shippingLine,
      etd: (proforma as any).etd,
      numberOfContainers: (proforma as any).numberOfContainers,
      warehouse: (proforma as any).warehouse,
      status: 'Ordered',
      sourceProformaId: proformaId,
      items: items as any,
    } as any;

    return this.create(payload);
  }

  // ────────────────────────────────────────────────────────────
  // PURCHASE RETURN
  // ────────────────────────────────────────────────────────────
async createPurchaseReturn(data: any): Promise<PurchaseInvoice> {
  const baseType: 'S' | 'G' | 'SR' = (data.baseType as any) ?? 'S';
  const yy = await this.getActiveYearYY();

  const prefix = baseType === 'G' ? `PVGR${yy}-` : `PVR${yy}-`;

  const last = await this.invoiceRepo
    .createQueryBuilder('pi')
    .select(['pi.id', 'pi.invoiceNumber'])
    .where('pi.invoiceNumber LIKE :p', { p: `${prefix}%` })
    .orderBy('pi.invoiceNumber', 'DESC')
    .getOne();

  let lastSeq = 0;
  if (last?.invoiceNumber?.startsWith(prefix)) {
    const part = last.invoiceNumber.replace(prefix, '');
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) lastSeq = n;
  }
  const nextSeq = lastSeq + 1;
  const invoiceNumber = `${prefix}${String(nextSeq).padStart(3, '0')}`;

  (data as any).supplierInvoiceNumber = (data as any).invoiceNumber ?? null;
  (data as any).invoiceNumber = invoiceNumber;
  (data as any).type = 'PR';
  (data as any).returnBaseType = baseType;

  const invoice = this.invoiceRepo.create(data as any);
  const savedInvoice = await this.invoiceRepo.save(invoice as any);

  if ((savedInvoice as any).status === 'Recieved') {
    await this.rebuildInventoryForPurchaseInvoice(
      { ...(savedInvoice as any), items: (savedInvoice as any).items } as any,
      [],
    );

    await this.createOrRebuildJVForPurchaseInvoice(
      savedInvoice as any,
      (((savedInvoice as any).items ?? []) as any),
      undefined,
    );
  }

  return savedInvoice;
}

  // ────────────────────────────────────────────────────────────
  // UPDATE (no recompute functions, no applyPurchaseCostsForInvoice)
  // ────────────────────────────────────────────────────────────
async update(id: number, data: Partial<PurchaseInvoice>) {
  const existing = await this.invoiceRepo.findOne({
    where: { id } as any,
    relations: ['items', 'items.itemVariant'],
  });
  if (!existing) throw new NotFoundException(`PurchaseInvoice ${id} not found`);

  const PI_FIELDS = ['date', 'supplierId', 'invoiceType', 'grandTotal', 'currency', 'notes', 'discount'];
  const oldSnapshot = {} as Record<string, any>;
  for (const f of PI_FIELDS) oldSnapshot[f] = (existing as any)[f] ?? null;

  const prevItemIds = (((existing as any).items ?? []) as any[])
    .map((it: any) => Number(it.id))
    .filter((n: number) => Number.isFinite(n) && n > 0);

  // old batch ids from txs (so deleted items batches get fixed)
  let oldBatchIds: number[] = [];
  if (prevItemIds.length) {
    const oldTxs = await this.inventoryTxRepo.find({
      where: { purchaseInvoiceItemId: In(prevItemIds) } as any,
    });
    oldBatchIds = Array.from(
      new Set(
        oldTxs
          .map((tx: any) => Number(tx.itemBatchId))
          .filter((n: number) => Number.isFinite(n) && n > 0),
      ),
    );
  }

  const {
    items: incomingItemsPayload,
    unitPriceRows: incomingUnitPriceRowsPayload,
    invoiceNumber: _ignoredInvoiceNumber,
    ...headerPayload
  } = (data as any) || {};

  const statusBeforeUpdate = (existing as any).status;

  if (headerPayload.etd === "" || headerPayload.etd === undefined) (headerPayload as any).etd = null;
  Object.assign(existing as any, headerPayload);
  (existing as any).unitPriceRows = undefined;

  // The real PV/PVG invoice number is only assigned once goods are actually
  // Recieved (see create()) — assigned at save time below (see
  // saveInvoiceAssigningNumberIfNeeded), before the JV rebuild further down,
  // since that copies invoiceNumber into jvNumber/docNbr.
  const needsNewInvoiceNumber =
    (existing as any).status === 'Recieved' &&
    statusBeforeUpdate !== 'Recieved' &&
    !(existing as any).invoiceNumber;

  // upsert items
  const incomingItems = (incomingItemsPayload ?? []).map((it: any) => ({ ...it }));
  const incomingItemIdSet = new Set<number>(
    incomingItems.filter((i: any) => i.id).map((i: any) => Number(i.id)),
  );

  const toDeleteItemIds = prevItemIds.filter((oldId) => !incomingItemIdSet.has(oldId));

  if (toDeleteItemIds.length) {
    await this.inventoryTxRepo.delete({ purchaseInvoiceItemId: In(toDeleteItemIds) } as any);
    await this.itemRepo.delete(toDeleteItemIds as any);
  }

  for (const raw of incomingItems) {
    if (raw.id) {
      await this.itemRepo.update(raw.id, { ...raw, invoiceId: (existing as any).id } as any);
    } else {
      const created = this.itemRepo.create({
        ...raw,
        invoice: { id: (existing as any).id } as any,
        invoiceId: (existing as any).id,
      } as any);
      await this.itemRepo.save(created as any);
    }
  }

  // reload items
  (existing as any).items = await this.itemRepo.find({
    where: { invoice: { id: (existing as any).id } } as any,
  });

  // save header
  const savedInvoice = await this.saveInvoiceAssigningNumberIfNeeded(existing as any, {
    needsNewNumber: needsNewInvoiceNumber,
    type: (existing as any).type,
  });

  // delete ALL old txs for previous items (safe)
  if (prevItemIds.length) {
    await this.inventoryTxRepo.delete({ purchaseInvoiceItemId: In(prevItemIds) } as any);
  }

  // rebuild inventory tx/batches/variant totals for updated invoice
  await this.rebuildInventoryForPurchaseInvoice(
    { ...(savedInvoice as any), items: (existing as any).items } as any,
    oldBatchIds,
  );

  // rebuild JV (delete old, recreate)
  const existingJvs = await this.journalVoucherRepo.find({
    where: { purchaseInvoiceId: (savedInvoice as any).id } as any,
  });

  if (existingJvs.length) {
    const jvIds = existingJvs
      .map((j: any) => Number(j.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (jvIds.length) {
      await this.journalVoucherDetailRepo.delete({ journalVoucherId: In(jvIds) } as any);
      await this.journalVoucherRepo.delete({ id: In(jvIds) } as any);
    }
  }

  await this.createOrRebuildJVForPurchaseInvoice(
    { ...(savedInvoice as any), items: (existing as any).items } as any,
    (existing as any).items,
    incomingUnitPriceRowsPayload,
  );

  // rebuild unit price rows
  await this.rowRepo.delete({ invoiceId: (savedInvoice as any).id } as any);

  if (incomingUnitPriceRowsPayload?.length) {
    const normalized = incomingUnitPriceRowsPayload.map((r: any) => {
      const v = Number(r.value ?? 0);
      const o = Number(r.valueOFR ?? 0);
      const ex = Number(r.valueExch ?? 0);
      const eo = Number(r.valueExchOFR ?? 0);

      return {
        ...r,
        value: v,
        valueOFR: v > 0 && o === 0 ? v : o,
        valueExch: ex,
        valueExchOFR: ex > 0 && eo === 0 ? ex : eo,
      };
    });

    const rowsToSave = normalized.map((row: any) => {
      const accountId =
        row.accountId != null
          ? Number(row.accountId)
          : row.account?.id != null
          ? Number(row.account.id)
          : null;

      const supplierId =
        row.supplierId != null
          ? Number(row.supplierId)
          : row.supplier?.id != null
          ? Number(row.supplier.id)
          : null;

      const taxAccountId =
        row.taxAccountId != null
          ? Number(row.taxAccountId)
          : row.taxAccount?.id != null
          ? Number(row.taxAccount.id)
          : null;

      const taxSupplierId =
        row.taxSupplierId != null
          ? Number(row.taxSupplierId)
          : row.taxSupplier?.id != null
          ? Number(row.taxSupplier.id)
          : null;

      const { id: _rowId, account, supplier, taxAccount, taxSupplier, ...rest } = row;

      return this.rowRepo.create({
        invoice: { id: (savedInvoice as any).id } as any,
        invoiceId: (savedInvoice as any).id,

        purchaseInvoiceSettingId: rest.purchaseInvoiceSettingId ?? null,
        chargeName: rest.chargeName,
        chargeType: rest.chargeType,
        value: Number(rest.value ?? 0),
        valueOFR: Number(rest.valueOFR ?? 0),
        currency: rest.currency,
        valueExch: Number(rest.valueExch ?? 0),
        valueExchOFR: Number(rest.valueExchOFR ?? 0),
        addToItemCost: rest.addToItemCost,
        invoiceNbTax: this.intOrNull(row.invoiceNbTax),
        shipping: rest.shipping,

        accountId,
        supplierId,

        // ✅ NEW: SAVE RELATIONS (so FK persists even if taxAccountId property isn't declared)
        taxAccount: taxAccountId ? ({ id: taxAccountId } as any) : null,
        taxSupplier: taxSupplierId ? ({ id: taxSupplierId } as any) : null,
      } as any);
    });

    await this.rowRepo.save(rowsToSave as any);
  }

  // ✅ compute averages ONLY for this invoice (no chain recompute)
  await this.computeAndWriteCostsForInvoice((savedInvoice as any).id);

  const _changes = computeDiff(oldSnapshot, savedInvoice as any, PI_FIELDS);
  return Object.keys(_changes).length
    ? Object.assign(savedInvoice as any, { _changes })
    : savedInvoice;
}


  // ────────────────────────────────────────────────────────────
  // READS
  // ────────────────────────────────────────────────────────────
  async findAll() {
    return this.invoiceRepo.find({
      relations: [
        'supplier',
        'items',
        'items.itemVariant',
        'unitPriceRows',
        'unitPriceRows.purchaseInvoiceSetting',
      ] as any,
    });
  }

 async findOne(id: number) {
  return this.invoiceRepo.findOne({
    where: { id } as any,
    relations: [
      'supplier',
      'items',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'unitPriceRows',
      'unitPriceRows.supplier',
      'unitPriceRows.supplier.account',
      'unitPriceRows.purchaseInvoiceSetting',

      // ✅ NEW
      'unitPriceRows.taxAccount',
      'unitPriceRows.taxSupplier',
    ] as any,
  });
}

  async findMinimalInvoices() {
    return this.invoiceRepo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.supplier', 'supplier')
      .select([
        'invoice.id',
        'invoice.invoiceNumber',
        'invoice.orderNumber',
        'invoice.proformaNumber',
        'invoice.sourceProformaId',
        'invoice.status',
        'invoice.date',
        'invoice.grandAmount',
        'invoice.isCompleted',
        'supplier.supplierName',
      ])
      .orderBy('invoice.id', 'DESC')
      .getMany();
  }

  // Manual mark — see the isCompleted column comment on the entity. Only
  // meaningful on a Proforma; kept simple (no item-diff/recompute side
  // effects unlike the main update() path) since it touches nothing else.
  async setProformaCompleted(id: number, completed: boolean) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } as any });
    if (!invoice) throw new NotFoundException(`PurchaseInvoice ${id} not found`);
    if (invoice.status !== 'Proforma') {
      throw new BadRequestException('Only a Proforma invoice can be marked completed.');
    }
    invoice.isCompleted = completed;
    await this.invoiceRepo.save(invoice);
    return invoice;
  }

  // ────────────────────────────────────────────────────────────
  // Controller-required methods (your TS errors)
  // ────────────────────────────────────────────────────────────
async getCostAnalysisHistory(q?: any): Promise<any[]> {
  // q can be a plain search string from the controller
  const searchText = typeof q === 'string' ? q.trim() : null;
  const tokens = searchText
    ? searchText.split(/\s+/).filter(Boolean)
    : [];

  const variantIdFilter =
    q?.itemVariantId != null
      ? Number(q.itemVariantId)
      : q?.variantId != null
      ? Number(q.variantId)
      : null;

  const qb = this.inventoryTxRepo.createQueryBuilder('tx');

  // ✅ subquery: the source batch (MovedFrom) batchId for the same transfer/date
  const movedFromBatchSub = qb
    .subQuery()
    .select('txo.itemBatchId')
    .from(InventoryTransaction, 'txo')
    .where('txo.transferId = tx.transferId')
    .andWhere(`txo.transactionType = 'MovedFrom'`)
    .andWhere('txo.dateForEachInvoice = tx.dateForEachInvoice')
    .orderBy('txo.id', 'DESC')
    .limit(1)
    .getQuery();

  // normalize location (your “codes” live in location)
  const locExpr = `UPPER(TRIM(tr.location))`;

  qb
    // 🔹 join purchase invoice items (for purchases)
    .leftJoin(PurchaseInvoiceItem, 'pii', 'pii.id = tx.purchaseInvoiceItemId')

    // 🔹 join transfer header (for JF/BOSTS detection)
    .leftJoin(Transfer, 'tr', 'tr.id = tx.transferId')

    // 🔹 join transfer items (for transfers)
    // ✅ IMPORTANT: do NOT join by itemVariantId (it is NULL in your table)
    // Normal transfers: match by tx.itemBatchId
    // Special (JF/BOSTS/FJ): MovedTo should match the MovedFrom batchId
    .leftJoin(
      TransferItem,
      'ti',
      `
      ti.transferId = tx.transferId
      AND (
        (
          ${locExpr} NOT IN ('JF','BOSTS','FJ')
          AND ti.itemBatchId = tx.itemBatchId
        )
        OR
        (
          ${locExpr} IN ('JF','BOSTS','FJ')
          AND tx.transactionType = 'MovedTo'
          AND ti.itemBatchId = (${movedFromBatchSub})
        )
      )
    `,
    )

    // 🔹 join variant → thickness → item
    .leftJoin(ItemVariant, 'iv', 'iv.id = tx.itemVariantId')
    .leftJoin(Thickness, 'th', 'th.id = iv.thicknessId')
    .leftJoin(Item, 'it', 'it.id = th.itemId')

    .select([
      'tx.id AS id',
      'tx.itemVariantId AS itemVariantId',
      'tx.transactionType AS transactionType',
      'tx.transactionDate AS transactionDate',
      'tx.dateForEachInvoice AS dateForEachInvoice',
      'tx.sqm AS sqm',
      'tx.sqmofr AS sqmofr',
      'tx.finalcost AS finalcost',
      'tx.finalcostofr AS finalcostofr',
      'tx.purchaseInvoiceItemId AS purchaseInvoiceItemId',
      'tx.transferId AS transferId',
      'tx.inventoryCountId AS inventoryCountId',
    ])
    .addSelect([
      // metadata
      'it.itemName AS itemName',
      'it.sortIndex AS itemSortIndex',
      'th.thickness AS thickness',
      'th.sort_index AS thicknessSortIndex',
      'iv.length AS length',
      'iv.width AS width',
      'iv.sheetsPerBox AS sheetsPerBox',
      'iv.origin AS origin',
      'iv.invoiceDisplayName AS invoiceDisplayName',

      // helpful: show transfer "code"
      'tr.location AS transferLocation',

      // previous qty (purchase only)
      'pii.previousQuantity AS previousQuantity',
      'pii.previousQuantityC AS previousQuantityC',
      'pii.previousQuantityVM AS previousQuantityVM',
      'pii.previousQuantityCVM AS previousQuantityCVM',

      // previous avg (purchase only)
      'pii.previousAverageCost AS previousAverageCost',
      'pii.previousAverageCostC AS previousAverageCostC',
      'pii.previousAverageCostVM AS previousAverageCostVM',
      'pii.previousAverageCostCVM AS previousAverageCostCVM',

      // running avg (purchase OR transfer)
      'COALESCE(pii.averageCost, ti.averageCost) AS averageCost',
      'COALESCE(pii.averageCostC, ti.averageCostC) AS averageCostC',
      'COALESCE(pii.averageCostVM, ti.averageCostVM) AS averageCostVM',
      'COALESCE(pii.averageCostCVM, ti.averageCostCVM) AS averageCostCVM',

      // purchase-only price info
      'pii.priceOFR AS priceOFR',
      'pii.finalOFR AS finalOFR',
    ])
    .where(
      new Brackets((b) => {
        b.where('tx.purchaseInvoiceItemId IS NOT NULL')
          .orWhere('tx.transferId IS NOT NULL')
          .orWhere('tx.inventoryCountId IS NOT NULL');
      }),
    );

  if (variantIdFilter) {
    qb.andWhere('tx.itemVariantId = :id', { id: variantIdFilter });
  }

  // Text search: each token must appear in the item name (Arabic-normalized)
  tokens.forEach((tok, idx) => {
    const like = `%${tok}%`;
    qb.andWhere(
      `(REPLACE(REPLACE(REPLACE(it.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx} OR it.itemName LIKE :tokR${idx})`,
      { [`tokN${idx}`]: like, [`tokR${idx}`]: like },
    );
  });

  return qb
    .orderBy('it.sortIndex', 'ASC')
    .addOrderBy('th.sort_index', 'ASC')
    .addOrderBy('iv.id', 'ASC')
    .addOrderBy('tx.dateForEachInvoice', 'ASC')
    .addOrderBy('tx.transactionDate', 'ASC')
    .addOrderBy('tx.id', 'ASC')
    .getRawMany();
}





  async getRealDescriptionCostHistory(q?: any): Promise<any[]> {
    const descId = Number(q?.itemNameDescriptionId || q?.descriptionId || 0);
    if (!descId) return [];

    const variants = await this.variantRepo.find({
      where: { itemNameDescriptionId: descId } as any,
      select: ['id'] as any,
    });

    const variantIds = variants
      .map((v: any) => Number(v.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (!variantIds.length) return [];

    return this.inventoryTxRepo
      .createQueryBuilder('tx')
      .select([
        'tx.id AS id',
        'tx.itemVariantId AS itemVariantId',
        'tx.transactionType AS transactionType',
        'tx.transactionDate AS transactionDate',
        'tx.dateForEachInvoice AS dateForEachInvoice',
        'tx.sqm AS sqm',
        'tx.sqmofr AS sqmofr',
        'tx.finalcost AS finalcost',
        'tx.finalcostofr AS finalcostofr',
        'tx.purchaseInvoiceItemId AS purchaseInvoiceItemId',
        'tx.transferId AS transferId',
        'tx.inventoryCountId AS inventoryCountId',
      ])
      .where('tx.itemVariantId IN (:...ids)', { ids: variantIds })
      .andWhere(
        new Brackets((b) => {
          b.where('tx.purchaseInvoiceItemId IS NOT NULL')
            .orWhere('tx.transferId IS NOT NULL')
            .orWhere('tx.inventoryCountId IS NOT NULL');
        }),
      )
      .orderBy('tx.dateForEachInvoice', 'ASC')
      .addOrderBy('tx.transactionDate', 'ASC')
      .addOrderBy('tx.id', 'ASC')
      .getRawMany();
  }


  
typescript// Add this method to your PurchaseInvoiceService class

/**
 * Get journal voucher(s) with details for a specific purchase invoice
 */
async getJournalVouchersForInvoice(purchaseInvoiceId: number) {
  // First verify the purchase invoice exists
  const invoice = await this.invoiceRepo.findOne({
    where: { id: purchaseInvoiceId } as any,
  });

  if (!invoice) {
    throw new NotFoundException(
      `Purchase invoice with ID ${purchaseInvoiceId} not found`,
    );
  }

  // Get all journal vouchers for this purchase invoice with their details
  const journalVouchers = await this.journalVoucherRepo.find({
    where: { purchaseInvoiceId } as any,
    relations: [
      'details',
      'details.account',
      'details.supplier',
      'details.customer',
      'details.exchangeRateAcc',
      'details.exchangeRateUSD',
      'exchangeRateAcc',
      'exchangeRateUSD',
    ],
    order: {
      date: 'DESC',
      id: 'DESC',
    } as any,
  });

  return {
    purchaseInvoice: {
      id: (invoice as any).id,
      invoiceNumber: (invoice as any).invoiceNumber,
      date: (invoice as any).date,
      type: (invoice as any).type,
      status: (invoice as any).status,
    },
    journalVouchers: journalVouchers.map((jv) => ({
      id: (jv as any).id,
      date: (jv as any).date,
      jvNumber: (jv as any).jvNumber,
      jvType: (jv as any).jvType,
      totalDr: (jv as any).totalDr,
      totalDrUSD: (jv as any).totalDrUSD,
      totalDrLL: (jv as any).totalDrLL,
      totalDrOFR: (jv as any).totalDrOFR,
      totalDrUSDOFR: (jv as any).totalDrUSDOFR,
      totalDrLLOFR: (jv as any).totalDrLLOFR,
      totalCr: (jv as any).totalCr,
      totalCrUSD: (jv as any).totalCrUSD,
      totalCrLL: (jv as any).totalCrLL,
      totalCrOFR: (jv as any).totalCrOFR,
      totalCrUSDOFR: (jv as any).totalCrUSDOFR,
      totalCrLLOFR: (jv as any).totalCrLLOFR,
      exchangeRateAcc: (jv as any).exchangeRateAcc,
      exchangeRateUSD: (jv as any).exchangeRateUSD,
      details: ((jv as any).details || []).map((detail: any) => ({
        id: detail.id,
        accountId: detail.accountId,
        account: detail.account
          ? {
              id: detail.account.id,
              name: detail.account.name,
              code: detail.account.code,
              accountNumber: detail.account.accountNumber,
            }
          : null,
        supplierId: detail.supplierId,
        supplier: detail.supplier
          ? {
              id: detail.supplier.id,
              name: detail.supplier.name,
              supplierName: detail.supplier.supplierName,
            }
          : null,
        customerId: detail.customerId,
        customer: detail.customer
          ? {
              id: detail.customer.id,
              customerName: detail.customer.customerName,
            }
          : null,
        description: detail.description,
        check: detail.check,
        checkDate: detail.checkDate,
        bankName: detail.bankName,
        dr: detail.dr,
        drUSD: detail.drUSD,
        drLL: detail.drLL,
        drOFR: detail.drOFR,
        drUSDOFR: detail.drUSDOFR,
        drLLOFR: detail.drLLOFR,
        cr: detail.cr,
        crUSD: detail.crUSD,
        crLL: detail.crLL,
        crOFR: detail.crOFR,
        crUSDOFR: detail.crUSDOFR,
        crLLOFR: detail.crLLOFR,
        currency: detail.currency,
        exRateEUROToUSD: detail.exRateEUROToUSD,
        exRateUSD: detail.exRateUSD,
        docNbr: detail.docNbr,
        exchangeRateAcc: detail.exchangeRateAcc,
        exchangeRateUSD: detail.exchangeRateUSD,
      })),
    })),
  };
}
}
