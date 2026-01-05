// src/csv-import/csv-import.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CsvImport } from '../entities/historyPrice.entity';

@Injectable()
export class CsvImportService {
  constructor(
    @InjectRepository(CsvImport)
    private readonly csvImportRepo: Repository<CsvImport>,
  ) {}

  // ✅ Get unique customers with pagination
  async getUniqueCustomers(
    page: number = 1,
    limit: number = 50,
    searchTerm?: string,
  ) {
    // Validate and set defaults
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    // Build WHERE clause for search
    const whereClause = searchTerm
      ? `WHERE customerName IS NOT NULL AND customerName != '' AND customerName LIKE ?`
      : `WHERE customerName IS NOT NULL AND customerName != ''`;

    const searchParam = searchTerm ? [`%${searchTerm}%`] : [];

    // Main query with pagination
    const query = `
      SELECT 
        customerName,
        COUNT(*) as totalOrders,
        ROUND(SUM(qty), 2) as totalQuantity,
        ROUND(SUM(qty * itemSalePrice), 2) as totalSales,
        ROUND(SUM(vat), 2) as totalVat,
        MIN(invoiceDate) as firstOrder,
        MAX(invoiceDate) as lastOrder
      FROM \`history-prices\`
      ${whereClause}
      GROUP BY customerName
      ORDER BY totalSales DESC
      LIMIT ? OFFSET ?
    `;

    // Count total unique customers
    const countQuery = `
      SELECT COUNT(DISTINCT customerName) as total
      FROM \`history-prices\`
      ${whereClause}
    `;

    // Execute both queries
    const data = await this.csvImportRepo.query(query, [
      ...searchParam,
      safeLimit,
      skip,
    ]);

    const totalResult = await this.csvImportRepo.query(
      countQuery,
      searchParam,
    );
    const total = totalResult[0].total;

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  // ✅ Get single customer details by name
  async getCustomerByName(customerName: string) {
    const query = `
      SELECT 
        customerName,
        COUNT(*) as totalOrders,
        COUNT(DISTINCT invoiceNbr) as uniqueInvoices,
        ROUND(SUM(qty), 2) as totalQuantity,
        ROUND(SUM(qty * itemSalePrice), 2) as totalSales,
        ROUND(SUM(vat), 2) as totalVat,
        ROUND(AVG(itemSalePrice), 2) as avgItemPrice,
        MIN(invoiceDate) as firstOrder,
        MAX(invoiceDate) as lastOrder
      FROM \`history-prices\`
      WHERE customerName = ?
      GROUP BY customerName
    `;

    const result = await this.csvImportRepo.query(query, [customerName]);

    if (!result || result.length === 0) {
      throw new NotFoundException(`Customer '${customerName}' not found`);
    }

    return result[0];
  }

  // ✅ Get customer's purchase history (with pagination)

async getCustomerHistory(
  customerName: string,
  page: number = 1,
  limit: number = 10000000,
  filters?: { itemName?: string; length?: number; width?: number }
) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(10000000, Math.max(1, Number(limit) || 50));
  const skip = (safePage - 1) * safeLimit;

  const conditions: string[] = [];
  const params: any[] = [];

  // ✅ ALWAYS filter by selected customer
  conditions.push("customerName = ?");
  params.push(customerName);

  // ✅ Optional filters
  if (filters?.itemName) {
    conditions.push("itemName LIKE ?");
    params.push(`%${filters.itemName}%`);
  }

  if (filters?.length !== undefined && filters?.length !== null) {
    conditions.push("length = ?");
    params.push(filters.length);
  }

  if (filters?.width !== undefined && filters?.width !== null) {
    conditions.push("width = ?");
    params.push(filters.width);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const query = `
    SELECT 
      id,
      customerName,
      invoiceDate,
      invoiceNbr,
      itemName,
      itemNumber,
      itemBrand,
      propertyCode,
      qty,
      qtyUnit,
      sheet,
      sqm,
      itemSalePrice,
      vat,
      length,
      width,
      ROUND(qty * itemSalePrice, 2) as lineTotal
    FROM \`history-prices\`
    ${whereClause}
    ORDER BY invoiceDate DESC, id DESC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(*) as total
    FROM \`history-prices\`
    ${whereClause}
  `;

  const data = await this.csvImportRepo.query(query, [
    ...params,
    safeLimit,
    skip,
  ]);

  const totalResult = await this.csvImportRepo.query(countQuery, params);
  const total = totalResult[0].total;

  return {
    data,
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
}



  // ✅ Get customer's top purchased items
  async getCustomerTopItems(customerName: string, limit: number = 10) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));

    const query = `
      SELECT 
        itemName,
        itemNumber,
        COUNT(*) as timesPurchased,
        ROUND(SUM(qty), 2) as totalQty,
        ROUND(AVG(itemSalePrice), 2) as avgPrice,
        ROUND(MIN(itemSalePrice), 2) as minPrice,
        ROUND(MAX(itemSalePrice), 2) as maxPrice,
        ROUND(SUM(qty * itemSalePrice), 2) as totalSpent
      FROM \`history-prices\`
      WHERE customerName = ?
      GROUP BY itemName, itemNumber
      ORDER BY timesPurchased DESC
      LIMIT ?
    `;

    return await this.csvImportRepo.query(query, [customerName, safeLimit]);
  }

  // ✅ Get customer purchase timeline (monthly aggregation)
  async getCustomerTimeline(customerName: string) {
    const query = `
      SELECT 
        DATE_FORMAT(invoiceDate, '%Y-%m') as month,
        COUNT(*) as orders,
        ROUND(SUM(qty), 2) as quantity,
        ROUND(SUM(qty * itemSalePrice), 2) as sales,
        ROUND(SUM(vat), 2) as vat
      FROM \`history-prices\`
      WHERE customerName = ?
      GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
      ORDER BY month DESC
    `;

    return await this.csvImportRepo.query(query, [customerName]);
  }


async searchHistory(filters: {
  itemName?: string;
  length?: number;
  width?: number;
  page?: number;
  limit?: number;
}) {
  const {
    itemName,
    length,
    width,
    page = 1,
    limit = 50,
  } = filters;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const skip = (safePage - 1) * safeLimit;

  // Build WHERE clause dynamically
  const conditions: string[] = [];
  const params: any[] = [];

  if (itemName) {
    conditions.push('itemName LIKE ?');
    params.push(`%${itemName}%`);
  }

  if (length !== undefined && length !== null) {
    conditions.push('length = ?');
    params.push(length);
  }

  if (width !== undefined && width !== null) {
    conditions.push('width = ?');
    params.push(width);
  }

  const whereClause = conditions.length > 0 
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Main query
  const query = `
    SELECT 
      id,
      customerName,
      invoiceDate,
      invoiceNbr,
      itemName,
      itemNumber,
      itemBrand,
      propertyCode,
      qty,
      qtyUnit,
      sheet,
      sqm,
      itemSalePrice,
      vat,
      length,
      width,
      ROUND(qty * itemSalePrice, 2) as lineTotal
    FROM \`history-prices\`
    ${whereClause}
    ORDER BY invoiceDate DESC, id DESC
    LIMIT ? OFFSET ?
  `;

  // Count query
  const countQuery = `
    SELECT COUNT(*) as total
    FROM \`history-prices\`
    ${whereClause}
  `;

  const data = await this.csvImportRepo.query(query, [
    ...params,
    safeLimit,
    skip,
  ]);

  const totalResult = await this.csvImportRepo.query(countQuery, params);
  const total = totalResult[0].total;

  return {
    data,
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
}
  
}