import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Put,
  ParseIntPipe,
  DefaultValuePipe,
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

  @Get("v1/:id")
  @RequirePerms("invoices.view")
  async getInvoiceById(@Param("id") id: number): Promise<Invoice> {
    return this.invoiceService.getInvoiceById(id);
  }

  @Get("filtered")
  @RequirePerms("invoices.view")
  async getFilteredInvoices(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(100), ParseIntPipe) limit: number
  ) {
    return this.invoiceService.getFilteredInvoices(page, limit);
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

  // UPDATE invoice
  @Put(":id")
  @RequirePerms("invoices.update")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: any
  ): Promise<Invoice> {
    return this.invoiceService.updateInvoice(id, body);
  }
}
