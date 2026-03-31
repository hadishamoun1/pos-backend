import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AccountsService } from "./accounts.service";
import { Account } from "../entities/account.entity";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerms } from "../auth/permissions.decorator";

@Controller("accounts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  // ✅ IMPORTANT: Specific routes MUST come BEFORE parameterized routes (:id)
  // Otherwise /accounts/v1/combined will match /accounts/:id with id="v1"

  // ========== SPECIFIC ROUTES FIRST ==========

  // Combined / arranged views (still "view")
  @Get("v1/combined")
  @RequirePerms("accounts.view")
  async getCombinedAccounts(): Promise<any[]> {
    return this.accountsService.getCombinedAccounts();
  }

  @Get("v1/acc-arranged")
  @RequirePerms("accounts.view")
  async getAccounts() {
    return this.accountsService.getCombinedAccounts();
  }

  @Get("v1/acc-flat-arranged")
  @RequirePerms("accounts.view")
  async getFlatSimplifiedAccounts(): Promise<any[]> {
    return this.accountsService.getFlatSimplifiedAccounts();
  }

  @Get("v1/payee-list")
  @RequirePerms("accounts.view")
  async getPayeeList(): Promise<{ id: number; accountNumber: string; accountName: string }[]> {
    return this.accountsService.getAccountsForPayee();
  }

  // Search used for JV selection (still "view")
  @Get("v1/jv/search")
  @RequirePerms("accounts.view")
  async search(
    @Query("q") q: string,
    @Query("type") type?: "account" | "customer" | "supplier",
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ): Promise<{
    data: Array<{
      id: number;
      accountNumber: string;
      accountName: string;
      kind: "account" | "customer" | "supplier";
      parentAccountNumber?: string;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const pg = Math.max(1, Number(page) || 1);
    const lm = Math.max(1, Math.min(200, Number(limit) || 50));
    const res = await this.accountsService.searchCombinedAccounts(
      q || "",
      type as any,
      pg,
      lm
    );

    return {
      data: res.data.map((r) => ({
        id: r.id,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        kind: r.kind,
        parentAccountNumber: r.parentAccountNumber,
      })),
      page: res.page,
      limit: res.limit,
      total: res.total,
    };
  }

  // ========== PARAMETERIZED ROUTES LAST ==========

  // CREATE
  @Post()
  @RequirePerms("accounts.create")
  async createAccount(@Body() accountData: Partial<Account>): Promise<Account> {
    return this.accountsService.createAccount(accountData);
  }

  // READ ALL
  @Get()
  @RequirePerms("accounts.view")
  async getAllAccounts(): Promise<Account[]> {
    return this.accountsService.getAllAccounts();
  }

  // READ BY ID - ✅ This MUST come AFTER all specific routes
  @Get(":id")
  @RequirePerms("accounts.view")
  async getAccountById(@Param("id") id: number): Promise<Account> {
    return this.accountsService.getAccountById(id);
  }

  // UPDATE
  @Put(":id")
  @RequirePerms("accounts.update")
  async updateAccount(
    @Param("id") id: number,
    @Body() accountData: Partial<Account>
  ): Promise<Account> {
    return this.accountsService.updateAccount(id, accountData);
  }

  // DELETE
  @Delete(":id")
  @RequirePerms("accounts.delete")
  async deleteAccount(@Param("id") id: number): Promise<void> {
    return this.accountsService.deleteAccount(id);
  }
}