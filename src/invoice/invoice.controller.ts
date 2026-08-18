import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Put,
  Patch,
  ParseIntPipe,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import { InvoiceService } from "./invoice.service";
import { Invoice } from "../entities/invoice.entity";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("invoices")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  // CREATE
  @Post()
  @RequirePerms("invoices.create")
  async createInvoice(@Body() invoiceData: Partial<Invoice>): Promise<Invoice> {
    return this.invoiceService.createInvoice(invoiceData);
  }

  // VIEW
  @Get()
  @RequirePerms("invoices.view")
  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceService.getAllInvoices();
  }

  @Get("v1/browsing/:customerId")
  @RequirePerms("invoices.view")
  async getBrowsing(
    @Param("customerId") customerId: number,
    @Query("groupKey") groupKey?: string,
    @Query("page") page = 1,
    @Query("limit") limit = 5
  ) {
    return this.invoiceService.getBrowsingInvoices(customerId, limit, page, groupKey);
  }

  @Get("v1/invoice-display-names-real")
  @RequirePerms("invoices.view")
  async listInvoiceDisplayNames(@Query("q") q?: string) {
    return this.invoiceService.listInvoiceDisplayNames({ q });
  }

  @Get("invoice-display-names-description")
  @RequirePerms("invoices.view")
  async listInvoiceDisplayNameDescription(@Query("q") q?: string) {
    return this.invoiceService.listInvoiceDisplayNameDescription({ q });
  }

  @Get("details")
  @RequirePerms("invoices.view")
  getAllDetails(
    @Query("type") type?: "S" | "G" | "RVR" | "RTN",
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string
  ) {
    return this.invoiceService.getAllInvoiceDetailsForView({
      type,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("v1/zero-vat")
  @RequirePerms("invoices.view")
  getZeroVatInvoices(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.invoiceService.getZeroVatInvoices({
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // browsing search
  @Get("v1/browsing/:customerId/search")
  @RequirePerms("invoices.view")
  async searchBrowsingForCustomer(
    @Param("customerId") customerId: string,
    @Query("q") q: string,
    @Query("limitPerGroup") limitPerGroup = "5",
    @Query("pagePerGroup") pagePerGroup = "1",
    @Query("groupKey") groupKey?: string
  ) {
    const limit = Number(limitPerGroup) || 5;
    const page = Number(pagePerGroup) || 1;
    return this.invoiceService.searchBrowsingInvoices(
      Number(customerId),
      q || "",
      limit,
      page,
      groupKey
    );
  }

  @Get("v1/filtered/search")
  @RequirePerms("invoices.view")
  async searchFiltered(
    @Query("q") q?: string,
    @Query("page") page = "1",
    @Query("limit") limit = "100"
  ) {
    const p = Number(page) || 1;
    const l = Number(limit) || 100;
    return this.invoiceService.searchFilteredInvoices(q, p, l);
  }

  @Get("v1/browsing/by-item-batches/:customerId")
  @RequirePerms("invoices.view")
  async getBrowsingByItemBatchesGet(
    @Param("customerId") customerIdParam: string,
    @Query("itemBatchIds") itemBatchIdsQuery: string | string[],
    @Query("groupKey") groupKey?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    const customerId = Number(customerIdParam);
    if (!customerId || Number.isNaN(customerId)) {
      throw new BadRequestException("customerId must be a number");
    }

    let itemBatchIds: number[] = [];
    if (Array.isArray(itemBatchIdsQuery)) {
      itemBatchIds = itemBatchIdsQuery
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n));
    } else if (typeof itemBatchIdsQuery === "string") {
      itemBatchIds = itemBatchIdsQuery
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isFinite(n));
    }

    if (itemBatchIds.length === 0) {
      throw new BadRequestException("itemBatchIds is required (one or more IDs).");
    }

    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 5;
    if (!Number.isFinite(pageNum) || pageNum < 1) {
      throw new BadRequestException("page must be a positive integer");
    }
    if (!Number.isFinite(limitNum) || limitNum < 1) {
      throw new BadRequestException("limit must be a positive integer");
    }

    return this.invoiceService.getBrowsingInvoicesByItemBatches(
      customerId,
      itemBatchIds,
      limitNum,
      pageNum,
      groupKey
    );
  }

  // GET /invoices/v1/batch?ids=1,2,3,4  — fetch multiple invoices at once for PDF export
  @Get("v1/batch")
  @RequirePerms("invoices.view")
  async getInvoicesBatch(@Query("ids") idsParam?: string) {
    const ids = (idsParam || "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return [];
    return this.invoiceService.getInvoicesByIds(ids);
  }

  @Get("v1/report")
  @RequirePerms("invoices.view")
  async getInvoiceReport(
    @Query("from")      from?:      string,
    @Query("to")        to?:        string,
    @Query("type")      type?:      string,
    @Query("minTotal")  minTotal?:  string,
    @Query("maxCount")  maxCount?:  string,
    @Query("all")       all?:       string,
    @Query("page")      page?:      string,
    @Query("limit")     limit?:     string,
  ) {
    const toSafeFloat = (v?: string) => {
      if (v == null || v.trim() === '') return undefined;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const toSafeInt = (v?: string, fallback = 1) => {
      if (v == null || v.trim() === '') return fallback;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    };

    return this.invoiceService.getInvoiceReport({
      from:      from?.trim()  || undefined,
      to:        to?.trim()    || undefined,
      type:      type?.trim()  || undefined,
      minTotal:  toSafeFloat(minTotal),
      maxCount:  toSafeFloat(maxCount),
      all:       all === 'true',
      page:      toSafeInt(page,  1),
      limit:     toSafeInt(limit, 100),
    });
  }

  @Get("v1/:id")
  @RequirePerms("invoices.view")
  async getInvoiceById(@Param("id") id: string): Promise<Invoice> {
    const numId = parseInt(id, 10);
    if (!Number.isFinite(numId)) {
      throw new BadRequestException(`Invalid invoice id: ${id}`);
    }
    return this.invoiceService.getInvoiceById(numId);
  }

  @Get("filtered")
  @RequirePerms("invoices.view")
  async getFilteredInvoices(
    @Query("page", ParseIntPipe) page = 1,
    @Query("limit", ParseIntPipe) limit = 100,
  ) {
    return this.invoiceService.getFilteredInvoices(page, limit);
  }

  // Free-form return (not linked to any single invoice, S or G base type)
  @Post("free-return")
  @RequirePerms("invoices.create")
  createFreeReturnInvoice(@Body() body: any): Promise<Invoice> {
    return this.invoiceService.createFreeReturnInvoice(body);
  }

  // RRVR invoice creation (free-form return, no batch deduction)
  @Post("rrvr")
  @RequirePerms("invoices.create")
  createRRVRInvoice(@Body() body: any): Promise<Invoice> {
    return this.invoiceService.createRRVRInvoice(body);
  }

  // return invoice creation
@Post(":id/return")
createReturnInvoice(
  @Param("id") id: string,
  @Body()
  body: {
    date?: string;
    note?: string;
    items: Array<{
      sourceInvoiceItemId?: number;
      itemBatchId: number;
      itemVariantId?: number;
      sqmPieceId?: number | null;
      length?: number | null;
      width?: number | null;
      quantity?: number;
      sqm?: number;
      note?: string;
    }>;
  },
) {
  return this.invoiceService.createReturnInvoice(Number(id), body);
}


  // update display names / fill defaults
  @Put("v1/invoice-display-names/fill-defaults")
  @RequirePerms("invoices.update")
  fillDefaults() {
    return this.invoiceService.fillMissingInvoiceDisplayNames();
  }

  @Put("v1/invoice-display-names")
  @RequirePerms("invoices.update")
  async updateInvoiceDisplayNames(
    @Body()
    body: {
      items: {
        itemVariantId: number;
        invoiceDisplayName: string | null;
      }[];
    }
  ) {
    return this.invoiceService.updateInvoiceDisplayNames(body);
  }

  // CONVERT invoice type S ↔ RVR
  @Patch(":id/convert-type")
  @RequirePerms("invoices.update")
  async convertType(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { newType: "S" | "RVR" },
  ) {
    return this.invoiceService.convertInvoiceType(id, body.newType);
  }

  // UPDATE invoice
  @Put(":id")
  @RequirePerms("invoices.update")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: any,
  ): Promise<Invoice> {
    return this.invoiceService.updateInvoice(id, body);
  }

  // UPDATE only the alternative customer (no item/inventory changes)
  @Patch(":id/alternative-customer")
  @RequirePerms("invoices.update")
  async updateAlternativeCustomer(
    @Param("id", ParseIntPipe) id: number,
    @Body("alternativeCustomerId") alternativeCustomerId: number | null,
  ): Promise<Invoice> {
    return this.invoiceService.updateAlternativeCustomer(id, alternativeCustomerId ?? null);
  }
}
