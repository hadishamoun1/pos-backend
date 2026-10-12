import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  Delete,
  ParseIntPipe,
  Query,
  Res,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response, Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { UnitPriceModalRow } from '../entities/Purchase-Invoice/unit-price-modal-row.entity';
// ✅ auth + perms
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

const blUploadDir = path.join(process.cwd(), 'uploads', 'bl-documents');
const BL_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const documentsUploadDir = path.join(process.cwd(), 'uploads', 'purchase-invoice-documents');
const DOCUMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

@Controller('purchase-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseInvoiceController {

  constructor(private readonly service: PurchaseInvoiceService) {}

  @Post()
  @RequirePerms('purchases.create')
  async create(@Body() body: any) {
    return this.service.create(body);
  }

  @Post('return')
  @RequirePerms('purchases.create')
  async createReturn(@Body() body: any) {
    return this.service.createPurchaseReturn(body);
  }

  // The Proforma's lines, each with how much has already been claimed by
  // earlier orders and how much is still available — feeds the "Create
  // Order" item picker.
  @Get(':id/proforma-items')
  @RequirePerms('purchases.view')
  async getProformaItems(@Param('id', ParseIntPipe) id: number) {
    return this.service.getProformaItemsWithRemaining(id);
  }

  // Spins off a new, separate Ordered invoice from a Proforma, containing
  // only the selected lines/quantities — the Proforma itself is left
  // untouched.
  @Post(':id/create-order')
  @RequirePerms('purchases.create')
  async createOrderFromProforma(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { items: { proformaItemId: number; quantity: number; sqm: number }[] },
  ) {
    return this.service.createOrderFromProforma(id, body?.items);
  }

  // Manual "I'm done splitting orders off this" mark — see the isCompleted
  // column comment on the entity. Drives the Proforma column's Completed
  // filter chip; nothing else derives it.
  @Put(':id/complete')
  @RequirePerms('purchases.update')
  async setProformaCompleted(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { completed: boolean },
  ) {
    return this.service.setProformaCompleted(id, Boolean(body?.completed));
  }

  @Get()
  @RequirePerms('purchases.view')
  getAll() {
    return this.service.findAll();
  }

  @Get('v1/minimal')
  @RequirePerms('purchases.view')
  getMinimalInvoices() {
    return this.service.findMinimalInvoices();
  }

  @Get('cost-analysis/history')
  @RequirePerms('purchases.view')
  getCostAnalysisHistory(@Query('q') q?: string) {
    return this.service.getCostAnalysisHistory(q);
  }

  @Get('cost-analysis/real-description-history')
  @RequirePerms('purchases.view')
  getRealDescHistory(@Query('q') q?: string) {
    return this.service.getRealDescriptionCostHistory(q);
  }

  @Get('shipment-links')
  @RequirePerms('purchases.view')
  getShipmentLinks() {
    return this.service.getShipmentLinks();
  }

  @Get('vessel-links')
  @RequirePerms('purchases.view')
  getVesselLinks() {
    return this.service.getVesselLinks();
  }

  // A single cost (typically customs clearance) that covers two or more
  // invoices at once — e.g. separate orders that arrived on the same vessel
  // and were cleared together — split proportionally by each invoice's
  // grand amount and written as a normal charge row on each.
  @Post('shared-charges')
  @RequirePerms('purchases.update')
  async createSharedCharge(
    @Body()
    body: {
      description: string;
      totalAmount: number;
      currency: string;
      invoiceIds: number[];
      chargeName?: string;
      addToItemCost?: boolean;
      shipping?: boolean;
    },
  ) {
    return this.service.createSharedCharge(body);
  }

  @Get(':id/shared-charges')
  @RequirePerms('purchases.view')
  async getSharedChargesForInvoice(@Param('id', ParseIntPipe) id: number) {
    return this.service.getSharedChargesForInvoice(id);
  }

  @Get(':id')
  @RequirePerms('purchases.view')
  getOne(@Param('id') id: string) {
    return this.service.findOne(+id);
  }

  @Get(':id/journal-vouchers')
  async getJournalVouchers(@Param('id', ParseIntPipe) id: number) {
    return this.service.getJournalVouchersForInvoice(id);
  }

  // Starts ShipsGo tracking for this invoice's BL number (spends 1 ShipsGo
  // credit) and links the returned shipment id to the invoice.
  @Post(':id/track-shipment')
  @RequirePerms('purchases.update')
  async trackShipment(@Param('id', ParseIntPipe) id: number) {
    return this.service.trackShipment(id);
  }

  // On-demand re-check of the linked ShipsGo shipment's status, applying the
  // same Ordered -> Shipped -> Recieved promotion the scheduled sync does.
  @Post(':id/sync-shipment')
  @RequirePerms('purchases.update')
  async syncShipment(@Param('id', ParseIntPipe) id: number) {
    return this.service.syncShipmentStatus(id);
  }

  // Removes the ShipsGo link — for a wrong BL tracked by mistake.
  @Delete(':id/track-shipment')
  @RequirePerms('purchases.update')
  async untrackShipment(@Param('id', ParseIntPipe) id: number) {
    return this.service.untrackShipment(id);
  }

  // Looks up candidate vessels by name (AIS, via VesselAPI) for a
  // charter-party/bulk shipment with no liner carrier — names aren't
  // unique, so this returns matches for the user to pick from rather than
  // tracking anything yet.
  @Get(':id/vessel-search')
  @RequirePerms('purchases.update')
  async searchVessel(@Param('id', ParseIntPipe) id: number, @Query('name') name: string) {
    return this.service.searchVessel(id, name);
  }

  // Confirms which vessel from the search results this invoice's cargo is
  // on, and does an initial position fetch.
  @Post(':id/track-vessel')
  @RequirePerms('purchases.update')
  async trackVessel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { imo?: string; mmsi?: string; name: string },
  ) {
    return this.service.trackVessel(id, body);
  }

  // On-demand re-check of the tracked vessel's position.
  @Post(':id/sync-vessel')
  @RequirePerms('purchases.update')
  async syncVessel(@Param('id', ParseIntPipe) id: number) {
    return this.service.syncVesselPosition(id);
  }

  // Removes the tracked vessel — for when the wrong one was picked.
  @Delete(':id/track-vessel')
  @RequirePerms('purchases.update')
  async untrackVessel(@Param('id', ParseIntPipe) id: number) {
    return this.service.untrackVessel(id);
  }

  // Uploads the scanned original Bill of Lading and tries to auto-fill
  // blNumber from it (via Claude — see BlExtractionService).
  @Post(':id/bl-document')
  @RequirePerms('purchases.update')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          fs.mkdirSync(blUploadDir, { recursive: true });
          cb(null, blUploadDir);
        },
        filename: (req, file, cb) => {
          const ts = Date.now();
          const ext = path.extname(file.originalname) || '';
          cb(null, `invoice-${req.params.id}_${ts}${ext}`);
        },
      }),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — plenty for a scanned page
      fileFilter: (req, file, cb) => {
        cb(null, BL_ALLOWED_MIME_TYPES.includes(file.mimetype));
      },
    }),
  )
  async uploadBlDocument(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    // Which tracking method Summary View 2 currently has selected, and
    // whether the user picked it deliberately (vs. it just being the
    // untouched default) — see service.uploadBlDocument() for how this
    // gates which extracted field actually gets written.
    @Body('mode') mode: string,
    @Body('modeLocked') modeLocked: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file received, or it was rejected — only PDF, JPEG, PNG, or WEBP are accepted.',
      );
    }
    return this.service.uploadBlDocument(id, file, mode, modeLocked === 'true');
  }

  // Streams the attached BL scan back for viewing/downloading in the browser.
  @Get(':id/bl-document')
  @RequirePerms('purchases.view')
  async getBlDocument(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { absolutePath, fileName, mimeType } = await this.service.getBlDocumentAbsolutePath(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    fs.createReadStream(absolutePath).pipe(res);
  }

  // Plain supporting documents (packing list, invoice copy, certificate of
  // origin, etc.) — just saved and served back as-is, no Claude extraction,
  // any number per invoice. Separate from the bl-document endpoints above.
  @Post(':id/documents')
  @RequirePerms('purchases.update')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          fs.mkdirSync(documentsUploadDir, { recursive: true });
          cb(null, documentsUploadDir);
        },
        filename: (req, file, cb) => {
          const ts = Date.now();
          const rand = Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname) || '';
          cb(null, `invoice-${req.params.id}_${ts}_${rand}${ext}`);
        },
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        cb(null, DOCUMENT_ALLOWED_MIME_TYPES.includes(file.mimetype));
      },
    }),
  )
  async uploadDocuments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException(
        'No files received, or they were rejected — only PDF, JPEG, PNG, WEBP, DOC(X), or XLS(X) are accepted.',
      );
    }
    return this.service.uploadDocuments(id, files);
  }

  @Get(':id/documents')
  @RequirePerms('purchases.view')
  async listDocuments(@Param('id', ParseIntPipe) id: number) {
    return this.service.listDocuments(id);
  }

  @Get(':id/documents/:docId')
  @RequirePerms('purchases.view')
  async getDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('docId', ParseIntPipe) docId: number,
    @Res() res: Response,
  ) {
    const { absolutePath, fileName, mimeType } = await this.service.getDocumentAbsolutePath(id, docId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    fs.createReadStream(absolutePath).pipe(res);
  }

  @Delete(':id/documents/:docId')
  @RequirePerms('purchases.update')
  async deleteDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    return this.service.deleteDocument(id, docId);
  }

  @Put(':id')
  @RequirePerms('purchases.update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: Partial<PurchaseInvoice> & {
      items?: Partial<PurchaseInvoiceItem>[];
      unitPriceRows?: Partial<UnitPriceModalRow>[];
    },
    @Req() req: Request,
  ) {
    await this.guardManualStatusChange(id, body, req);
    return this.service.update(id, body);
  }

  // Shipped/Recieved are meant to come from the shipment-tracking sync, not
  // a manual edit — this only guards the HTTP entry point, so the sync
  // job's own direct service.update() calls are unaffected. Purchase
  // Returns (type 'PR') never ship, so they're exempt.
  private async guardManualStatusChange(id: number, body: any, req: Request) {
    const nextStatus = body?.status;
    if (nextStatus === undefined) return;

    const current = await this.service.findOne(id);
    if (!current) return; // let update() surface the 404

    // Proforma is a permanent record — it never becomes an order in place.
    // "Create Order" (createOrderFromProforma) is the only way forward from
    // it, spinning off a separate linked invoice instead.
    if ((current as any).status === 'Proforma' && nextStatus !== 'Proforma') {
      throw new BadRequestException(
        'A Proforma invoice can\'t be changed to another status directly — use "Create Order" to spin off a separate order from it instead.',
      );
    }

    if (nextStatus !== 'Shipped' && nextStatus !== 'Recieved') return;

    const type = body?.type ?? (current as any).type;
    if (type === 'PR') return;

    if ((current as any).status === nextStatus) return; // no actual change

    // Safety valve for vessel (AIS) tracked invoices: automation drives this
    // by default, but AIS data quality is out of our control (a provider's
    // feed for a given vessel can just stall — seen in practice), and there
    // needs to be a way to manually finish Shipped -> Recieved if it never
    // fires. Shipped stays auto-only; only the final step is overridable —
    // and only by an admin, so it's not something any purchases.update user
    // can casually flip.
    const isVesselTracked = Boolean((current as any).vesselImo || (current as any).vesselMmsi);
    if (isVesselTracked && nextStatus === 'Recieved' && (current as any).status === 'Shipped') {
      if ((req as any).user?.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Only an admin can manually confirm this shipment as Recieved.',
        );
      }
      return;
    }

    throw new BadRequestException(
      `Status can't be set to "${nextStatus}" manually — it's updated automatically by shipment tracking once this invoice's BL is tracked. Use "Track Shipment" on the BL field instead.`,
    );
  }
}