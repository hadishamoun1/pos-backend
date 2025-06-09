import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, DataSource } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { Customer } from '../entities/customer.entity';
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity';
import { SalesVoucherDetail } from '../entities/Vouchers/salesVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { InvoiceGateway } from './invoice.gateway';
interface InvoiceWithDetails extends Partial<Invoice> {
  details?: SalesVoucherDetail[]; // Define the 'details' property explicitly
}
@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(SalesVoucher)
    private readonly salesVoucherRepository: Repository<SalesVoucher>,
    @InjectRepository(SalesVoucherDetail)
    private readonly salesVoucherDetailRepository: Repository<SalesVoucherDetail>,
    private readonly invoiceGateway: InvoiceGateway,
  ) {}
  /**
   * ✅ Generate a unique Invoice Number (S25-001 or G25-001)
   */
  private async generateInvoiceNumber(
    invoiceType: 'S' | 'G',
    queryRunner: any,
  ): Promise<string> {
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = `${invoiceType}${year}`;
    const lastInvoice = await queryRunner.manager.findOne(Invoice, {
      where: { invoiceNumber: Like(`${prefix}-%`) },
      order: { invoiceNumber: 'DESC' },
    });

    let nextNumber = 1;
    if (lastInvoice) {
      const match = lastInvoice.invoiceNumber.match(/\d+$/);
      if (match) {
        nextNumber = parseInt(match[0], 10) + 1;
      }
    }
    return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
  }

  async createInvoice(invoiceData: Partial<Invoice>): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const {
        customerId,
        invoiceType,
        date,
        currencyRate,
        vatPercentage,
        items,
        ...otherFields
      } = invoiceData;

      if (!customerId || !invoiceType || !date || !currencyRate) {
        throw new Error(
          `Missing required fields: customerId=${customerId}, invoiceType=${invoiceType}, date=${date}, currencyRate=${currencyRate}`,
        );
      }

      console.log('🔍 Processing Invoice Creation...');

      const customer = await queryRunner.manager.findOne(Customer, {
        where: { id: customerId },
      });
      if (!customer)
        throw new NotFoundException(`Customer ID ${customerId} not found.`);

      const invoiceNumber = await this.generateInvoiceNumber(
        invoiceType,
        queryRunner,
      );

      let totalVAT = 0;
      let grandTotal = 0;
      let invoiceItems: InvoiceItem[] = [];

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('No items provided for the invoice.');
      }

      for (const item of items) {
        if (
          !item.itemVariantId ||
          item.sqm === undefined ||
          item.unitPrice === undefined ||
          item.vat === undefined ||
          item.quantity === undefined
        ) {
          throw new Error(`Invalid item data: ${JSON.stringify(item)}`);
        }

        const itemVariant = await queryRunner.manager.findOne(ItemVariant, {
          where: { id: item.itemVariantId },
        });

        if (!itemVariant) {
          throw new NotFoundException(
            `ItemVariant ID ${item.itemVariantId} not found.`,
          );
        }

        const sqm =
          typeof item.sqm === 'string' ? parseFloat(item.sqm) : item.sqm;
        const unitPrice =
          typeof item.unitPrice === 'string'
            ? parseFloat(item.unitPrice)
            : item.unitPrice;
        const vat =
          typeof item.vat === 'string' ? parseFloat(item.vat) : item.vat;

        const quantity =
          typeof item.quantity === 'string'
            ? parseInt(item.quantity, 10)
            : item.quantity;

        if (isNaN(sqm) || isNaN(unitPrice) || isNaN(vat) || isNaN(quantity)) {
          throw new Error(
            `Invalid number values for itemVariantId ${item.itemVariantId}: sqm=${sqm}, unitPrice=${unitPrice}, vat=${vat}, quantity=${quantity}`,
          );
        }

        const totalAmount = sqm * unitPrice;
        totalVAT += vat;
        grandTotal += totalAmount + vat;

        const invoiceItem = queryRunner.manager.create(InvoiceItem, {
          invoice: null,
          itemVariant,
          sqm,
          unitPrice,
          totalAmount,
          vat,
          quantity,
        });

        invoiceItems.push(invoiceItem);
      }

      const totalWithoutVAT = grandTotal - totalVAT;
      const invoice = queryRunner.manager.create(Invoice, {
        customer,
        invoiceNumber,
        invoiceType,
        date,
        totalWithoutVAT,
        totalVAT,
        grandTotal,
        currencyRate,
        vatPercentage,
        ...otherFields,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);
      console.log('✅ Invoice Created:', savedInvoice);

      for (const item of invoiceItems) {
        item.invoice = savedInvoice;
        await queryRunner.manager.save(item);
      }

      const svNumber = await this.generateInvoiceNumber(
        invoiceType,
        queryRunner,
      );
      const salesVoucher = queryRunner.manager.create(SalesVoucher, {
        date,
        invoice: savedInvoice,
        svNumber,
        totalDr: grandTotal,
        totalDrUSD: grandTotal,
        totalDrLL: grandTotal * currencyRate,
        totalCr: grandTotal,
        totalCrUSD: grandTotal,
        totalCrLL: grandTotal * currencyRate,
        exchangeRate: currencyRate,
      });
      const savedVoucher = await queryRunner.manager.save(salesVoucher);

      await queryRunner.manager.save([
        queryRunner.manager.create(SalesVoucherDetail, {
          salesVoucher: savedVoucher,
          customer,
          dr: grandTotal,
          drUSD: grandTotal,
          drLL: grandTotal * currencyRate,
          cr: 0,
          crUSD: 0,
          crLL: 0,
          exchangeRate: currencyRate,
        }),
        queryRunner.manager.create(SalesVoucherDetail, {
          salesVoucher: savedVoucher,
          account: await queryRunner.manager.findOne(Account, {
            where: { accountNumber: '7011' },
          }),
          cr: totalWithoutVAT,
          crUSD: totalWithoutVAT,
          crLL: totalWithoutVAT * currencyRate,
          dr: 0,
          drUSD: 0,
          drLL: 0,
          exchangeRate: currencyRate,
        }),
        queryRunner.manager.create(SalesVoucherDetail, {
          salesVoucher: savedVoucher,
          account: await queryRunner.manager.findOne(Account, {
            where: { accountNumber: '4431' },
          }),
          cr: totalVAT,
          crUSD: totalVAT,
          crLL: totalVAT * currencyRate,
          dr: 0,
          drUSD: 0,
          drLL: 0,
          exchangeRate: currencyRate,
        }),
      ]);

      for (const item of invoiceItems) {
        const inventoryTransaction = queryRunner.manager.create(
          InventoryTransaction,
          {
            itemVariant: item.itemVariant,
            transactionType: 'sale',
            sqm: item.sqm,
            transactionDate: new Date(),
            invoiceItem: item,
          },
        );

        await queryRunner.manager.save(inventoryTransaction);
        await queryRunner.manager.increment(
          ItemVariant,
          { id: item.itemVariant.id },
          'out',
          item.sqm,
        );
        await queryRunner.manager.decrement(
          ItemVariant,
          { id: item.itemVariant.id },
          'balance',
          item.sqm,
        );
      }

      await queryRunner.commitTransaction();
      console.log('✅ Invoice successfully committed.');

      const finalInvoice = await queryRunner.manager.findOne(Invoice, {
        where: { id: savedInvoice.id },
        relations: ['customer', 'items', 'items.itemVariant'],
      });

      const { customerName } = finalInvoice.customer || {}; // Extract customerName
      const invoiceToEmit = {
        ...finalInvoice,
        customerName, // Add customerName directly to the emitted invoice
      };

      // Emit the new invoice to all connected clients via WebSocket
      this.invoiceGateway.emitNewInvoice(invoiceToEmit);
      console.log(`invoice: ${JSON.stringify(invoiceToEmit)}`);
      return finalInvoice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Error creating invoice:', error.message, error.stack);
      throw new Error(`Invoice creation failed: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      relations: ['customer', 'items'],
    });
  }
  async getInvoiceById(invoiceId: number): Promise<any> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: [
        'customer',
        'items',
        'items.itemVariant',
        'items.itemVariant.thickness',
        'items.itemVariant.thickness.item',
      ],
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // ✅ Format the response to be more user-friendly
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      invoiceType: invoice.invoiceType,
      documentNumber: invoice.documentNumber || null,
      totalWithoutVAT: invoice.totalWithoutVAT,
      totalVAT: invoice.totalVAT,
      grandTotal: invoice.grandTotal,
      currencyRate: invoice.currencyRate,
      vatPercentage: invoice.vatPercentage,

      // ✅ Flattened customer info
      customerId: invoice.customer?.id,
      customerName: invoice.customer?.customerName,
      customerInvoiceType: invoice.customer?.invoiceType,

      // ✅ Reformatted items list for easier frontend use
      items: invoice.items.map((item) => {
        const variant = item.itemVariant;
        const thickness = variant?.thickness;
        const itemData = thickness?.item;

        return {
          invoiceItemId: item.id,
          sqm: item.sqm,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
          vat: item.vat,
          quantity: item.quantity, // ✅ Overall quantity (box/sheet)

          // ✅ Item Details
          itemVariantId: variant?.id,
          itemName: itemData?.itemName,
          itemType: itemData?.type, // 'box' or 'sheet'
          thickness: thickness?.thickness, // e.g., "10mm"
          length: variant?.length,
          width: variant?.width,
          origin: variant?.origin,
          sheetsPerBox: variant?.sheetsPerBox, // ✅ Sheets per box
          totalSheets: item.quantity * (variant?.sheetsPerBox || 1), // ✅ Total sheets calculated

          // ✅ Inventory Tracking
        
          // ✅ Box/Sheet Specific Flags
          fixBox: variant?.fixBox,
          fixLength: variant?.fixLength,
          fixWidth: variant?.fixWidth,
        };
      }),
    };
  }

  async getFilteredInvoices(
    page: number,
    limit: number,
  ): Promise<{ data: any[]; total: number; totalPages: number }> {
    const [invoices, total] = await this.invoiceRepository.findAndCount({
      relations: ['customer'],
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        totalWithoutVAT: invoice.totalWithoutVAT,
        totalVAT: invoice.totalVAT,
        grandTotal: invoice.grandTotal,
        customerId: invoice.customer?.id,
        customerName: invoice.customer?.customerName,
        invoiceType: invoice.invoiceType,
      })),
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async editInvoice(
    invoiceId: number,
    invoiceData: Partial<Invoice>,
  ): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log('Editing invoice with ID:', invoiceId);

      // Step 1: Fetch the existing invoice and the sales voucher with its details
      const existingInvoice = await queryRunner.manager.findOne(Invoice, {
        where: { id: invoiceId },
        relations: [
          'items',
          'customer',
          'items.itemVariant',
          'salesVouchers',
          'salesVouchers.details',
          'salesVouchers.details.account',
        ],
      });

      if (!existingInvoice) {
        throw new NotFoundException(`Invoice ID ${invoiceId} not found`);
      }

      console.log('Existing invoice fetched:', existingInvoice);

      const existingItemVariantIds = existingInvoice.items.map(
        (item) => item.itemVariant.id,
      );
      const newItemVariantIds = invoiceData.items.map((i) => i.itemVariantId);

      // Phase 2: Handle deleted items
      for (const item of existingInvoice.items) {
        if (!newItemVariantIds.includes(item.itemVariant.id)) {
          const inventoryTransaction = await queryRunner.manager.findOne(
            InventoryTransaction,
            {
              where: { invoiceItem: item },
            },
          );

        
         

          await queryRunner.manager.remove(item);
        }
      }

      // Phase 3 & 4: Update existing or add new items
      for (const itemData of invoiceData.items) {
        if (!itemData.itemVariantId) {
          throw new NotFoundException(
            `Item Variant ID ${itemData.itemVariantId} not found.`,
          );
        }

        const itemVariant = await queryRunner.manager.findOne(ItemVariant, {
          where: { id: itemData.itemVariantId },
        });

        if (!itemVariant) {
          throw new NotFoundException(
            `Item Variant ID ${itemData.itemVariantId} not found.`,
          );
        }

        const existingItem = existingInvoice.items.find(
          (item) =>
            Number(item.itemVariant.id) === Number(itemData.itemVariantId),
        );

        const totalAmount = itemData.unitPrice * itemData.sqm;
        const vatPercentage = Number(invoiceData.vatPercentage);
        const vat = totalAmount * (vatPercentage / 100);

        if (existingItem) {
          // ✅ Update Invoice Item
          existingItem.sqm = itemData.sqm;
          existingItem.unitPrice = itemData.unitPrice;
          existingItem.quantity = itemData.quantity;
          existingItem.totalAmount = totalAmount;
          existingItem.vat = vat;

          await queryRunner.manager.save(existingItem);

          // ✅ Find Inventory Transaction
          const inventoryTransaction = await queryRunner.manager.findOne(
            InventoryTransaction,
            {
              where: { invoiceItem: { id: existingItem.id } },
            },
          );

          if (inventoryTransaction) {
            const oldSqm = Number(inventoryTransaction.sqm);
            const newSqm = Number(itemData.sqm);
            const sqmDifference = newSqm - oldSqm;

      
            

            // ✅ Update Inventory Transaction
            inventoryTransaction.sqm = newSqm;
            inventoryTransaction.transactionDate = new Date();
            inventoryTransaction.transactionType = 'sale'; // 🔁 Always set as sale
            await queryRunner.manager.save(inventoryTransaction);
          } else {
            console.warn(
              `⚠️ No InventoryTransaction found for invoice item ${existingItem.id}`,
            );
          }
        } else {
          // ✅ Create New Invoice Item
          const newItem = queryRunner.manager.create(InvoiceItem, {
            invoice: existingInvoice,
            itemVariant,
            sqm: itemData.sqm,
            unitPrice: itemData.unitPrice,
            totalAmount,
            vat,
            quantity: itemData.quantity,
          });

          await queryRunner.manager.save(newItem);
          existingInvoice.items.push(newItem);

          // ✅ Update ItemVariant
      
          // ✅ Create Inventory Transaction
          const newTransaction = queryRunner.manager.create(
            InventoryTransaction,
            {
              itemVariant,
              sqm: itemData.sqm,
              transactionType: 'sale',
              invoiceItem: newItem,
              transactionDate: new Date(),
            },
          );
          await queryRunner.manager.save(newTransaction);
        }
      }

      // Phase 5: Update Invoice Totals
      existingInvoice.currencyRate =
        invoiceData.currencyRate || existingInvoice.currencyRate;
      existingInvoice.vatPercentage =
        invoiceData.vatPercentage || existingInvoice.vatPercentage;

      // ✅ Refresh items from DB to ensure accurate calculation
      existingInvoice.items = await queryRunner.manager.find(InvoiceItem, {
        where: { invoice: { id: existingInvoice.id } },
      });

      // 🧮 Reset totals
      existingInvoice.totalWithoutVAT = 0;
      existingInvoice.totalVAT = 0;
      existingInvoice.grandTotal = 0;

      // 🔁 Recalculate based on refreshed items
      for (const item of existingInvoice.items) {
        existingInvoice.totalWithoutVAT += Number(item.totalAmount);
        existingInvoice.totalVAT += Number(item.vat);
        existingInvoice.grandTotal +=
          Number(item.totalAmount) + Number(item.vat);
      }

      await queryRunner.manager.save(existingInvoice);

      // Phase 6: Update SalesVoucher
      const salesVoucher = existingInvoice.salesVouchers[0];
      salesVoucher.totalDr = existingInvoice.grandTotal;
      salesVoucher.totalCr = existingInvoice.grandTotal;
      salesVoucher.totalDrUSD = existingInvoice.grandTotal;
      salesVoucher.totalCrUSD = existingInvoice.grandTotal;
      salesVoucher.totalDrLL =
        existingInvoice.grandTotal * existingInvoice.currencyRate;
      salesVoucher.totalCrLL =
        existingInvoice.grandTotal * existingInvoice.currencyRate;

      for (const detail of salesVoucher.details) {
        if (detail.account) {
          const account = detail.account;
          if (account.accountNumber === '7011') {
            detail.cr = existingInvoice.totalWithoutVAT;
            detail.crUSD = existingInvoice.totalWithoutVAT;
            detail.crLL =
              existingInvoice.totalWithoutVAT * existingInvoice.currencyRate;
            detail.dr = 0;
            detail.drUSD = 0;
            detail.drLL = 0;
          } else if (account.accountNumber === '4431') {
            detail.cr = existingInvoice.totalVAT;
            detail.crUSD = existingInvoice.totalVAT;
            detail.crLL =
              existingInvoice.totalVAT * existingInvoice.currencyRate;
            detail.dr = 0;
            detail.drUSD = 0;
            detail.drLL = 0;
          }
        } else {
          detail.dr = existingInvoice.grandTotal;
          detail.drUSD = existingInvoice.grandTotal;
          detail.drLL =
            existingInvoice.grandTotal * existingInvoice.currencyRate;
          detail.cr = 0;
          detail.crUSD = 0;
          detail.crLL = 0;
        }

        await queryRunner.manager.save(detail);
      }

      await queryRunner.manager.save(salesVoucher);

      await queryRunner.commitTransaction();
      console.log('✅ Invoice and SalesVoucher updated successfully!');

      return existingInvoice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error(
        '❌ Error updating invoice and sales voucher:',
        error.message,
        error.stack,
      );
      throw new Error(
        `Invoice and SalesVoucher update failed: ${error.message}`,
      );
    } finally {
      await queryRunner.release();
    }
  }
}
// async editInvoice(
//   invoiceId: number,
//   invoiceData: Partial<Invoice>,
// ): Promise<Invoice> {
//   const queryRunner = this.dataSource.createQueryRunner();
//   await queryRunner.connect();
//   await queryRunner.startTransaction();

//   try {
//     console.log('Editing invoice with ID:', invoiceId);

//     // Step 1: Fetch the existing invoice and the sales voucher with its details
//     const existingInvoice = await queryRunner.manager.findOne(Invoice, {
//       where: { id: invoiceId },
//       relations: [
//         'items',
//         'customer',
//         'items.itemVariant',
//         'salesVouchers',
//         'salesVouchers.details',
//         'salesVouchers.details.account',
//       ],
//     });

//     if (!existingInvoice) {
//       throw new NotFoundException(`Invoice ID ${invoiceId} not found`);
//     }

//     console.log('Existing invoice fetched:', existingInvoice);

//     // Step 2: Reverse the old inventory transactions (to undo the previous sale)
//     for (const item of existingInvoice.items) {
//       if (item.itemVariant) {
//         // Reverse the previous inventory transaction
//         const inventoryTransaction = await queryRunner.manager.findOne(
//           InventoryTransaction,
//           {
//             where: { invoiceItem: item },
//           },
//         );

//         if (inventoryTransaction) {
//           await queryRunner.manager.update(
//             ItemVariant,
//             { id: item.itemVariant.id },
//             {
//               out: () => `out - ${inventoryTransaction.sqm}`,
//               balance: () => `balance + ${inventoryTransaction.sqm}`,
//             },
//           );

//           await queryRunner.manager.remove(inventoryTransaction); // Remove the old inventory transaction
//         } else {
//           console.warn('No inventory transaction found for item:', item);
//         }
//       } else {
//         console.error('Item Variant is missing for item:', item);
//       }
//     }

//     // Step 3: Update the invoice core fields (currencyRate, vatPercentage)
//     existingInvoice.currencyRate =
//       invoiceData.currencyRate || existingInvoice.currencyRate;
//     existingInvoice.vatPercentage =
//       invoiceData.vatPercentage || existingInvoice.vatPercentage;

//     // Step 4: Update the invoice details with the new data
//     existingInvoice.items = [];
//     existingInvoice.totalWithoutVAT = 0;
//     existingInvoice.totalVAT = 0;
//     existingInvoice.grandTotal = 0;

//     for (const itemData of invoiceData.items) {
//       console.log('Item data:', itemData);

//       if (!itemData.itemVariantId) {
//         throw new NotFoundException(
//           `Item Variant ID ${itemData.itemVariantId} not found.`,
//         );
//       }

//       const itemVariant = await queryRunner.manager.findOne(ItemVariant, {
//         where: { id: itemData.itemVariantId },
//       });

//       if (!itemVariant) {
//         throw new NotFoundException(
//           `Item Variant ID ${itemData.itemVariantId} not found.`,
//         );
//       }

//       // Calculate the totalAmount, vat, and grandTotal
//       const totalAmount = itemData.sqm * itemData.unitPrice;
//       const vat = totalAmount * (existingInvoice.vatPercentage / 100);
//       const grandTotal = totalAmount + vat;

//       const invoiceItem = queryRunner.manager.create(InvoiceItem, {
//         invoice: existingInvoice,
//         itemVariant,
//         sqm: itemData.sqm,
//         unitPrice: itemData.unitPrice,
//         totalAmount: totalAmount,
//         vat: vat,
//         quantity: itemData.quantity,
//       });

//       existingInvoice.items.push(invoiceItem);
//       existingInvoice.totalWithoutVAT += totalAmount;
//       existingInvoice.totalVAT += vat;
//       existingInvoice.grandTotal += grandTotal;

//       await queryRunner.manager.save(invoiceItem);
//     }

//     // Step 5: Update the corresponding SalesVoucher and SalesVoucherDetail for the invoice
//     const salesVoucher = existingInvoice.salesVouchers[0]; // Assuming only one salesVoucher for each invoice

//     if (!salesVoucher) {
//       throw new NotFoundException('SalesVoucher not found for this invoice.');
//     }

//     // Debugging: Check the values before updating the SalesVoucher
//     console.log('Total Without VAT:', existingInvoice.totalWithoutVAT);
//     console.log('Total VAT:', existingInvoice.totalVAT);
//     console.log('Currency Rate:', existingInvoice.currencyRate);
//     console.log('Vat Percentage', existingInvoice.vatPercentage);

//     // Update SalesVoucher
//     salesVoucher.totalDr = existingInvoice.grandTotal;
//     salesVoucher.totalCr = existingInvoice.grandTotal;
//     salesVoucher.totalDrUSD = existingInvoice.grandTotal;
//     salesVoucher.totalCrUSD = existingInvoice.grandTotal;
//     salesVoucher.totalDrLL =
//       existingInvoice.grandTotal * existingInvoice.currencyRate;
//     salesVoucher.totalCrLL =
//       existingInvoice.grandTotal * existingInvoice.currencyRate;

//     // Loop through SalesVoucherDetails and update them
//     for (const detail of salesVoucher.details) {
//       if (detail.account) {
//         const account = detail.account; // Account object
//         console.log(
//           `Updating SalesVoucherDetail (ID: ${detail.id}) for account: ${account.accountNumber}`,
//         );

//         if (account.accountNumber === '7011') {
//           // For account 7011 (Sales): Set credit to total without VAT, set debit to 0
//           console.log('Setting values for account 7011 (Sales)');
//           detail.cr = existingInvoice.totalWithoutVAT;
//           detail.crUSD = existingInvoice.totalWithoutVAT;
//           detail.crLL =
//             existingInvoice.totalWithoutVAT * existingInvoice.currencyRate;
//           detail.dr = 0;
//           detail.drUSD = 0;
//           detail.drLL = 0;
//         } else if (account.accountNumber === '4431') {
//           // For account 4431 (VAT): Set credit to total VAT, set debit to 0
//           console.log('Setting values for account 4431 (VAT)');
//           detail.cr = existingInvoice.totalVAT;
//           detail.crUSD = existingInvoice.totalVAT;
//           detail.crLL =
//             existingInvoice.totalVAT * existingInvoice.currencyRate;
//           detail.dr = 0;
//           detail.drUSD = 0;
//           detail.drLL = 0;
//         }
//       } else {
//         // If account is null (Customer transaction)
//         console.log('Setting values for customer transaction');
//         detail.dr = existingInvoice.grandTotal;
//         detail.drUSD = existingInvoice.grandTotal;
//         detail.drLL =
//           existingInvoice.grandTotal * existingInvoice.currencyRate;
//         detail.cr = 0;
//         detail.crUSD = 0;
//         detail.crLL = 0;
//       }

//       // Print the updated details to check
//       console.log('Updated SalesVoucherDetail:', detail);

//       // Save the updated SalesVoucherDetail
//       await queryRunner.manager.save(detail);
//     }

//     // Save the updated SalesVoucher
//     await queryRunner.manager.save(salesVoucher);

//     // Step 6: Commit the transaction
//     await queryRunner.commitTransaction();
//     console.log('✅ Invoice and SalesVoucher updated successfully!');

//     return existingInvoice;
//   } catch (error) {
//     await queryRunner.rollbackTransaction();
//     console.error(
//       '❌ Error updating invoice and sales voucher:',
//       error.message,
//       error.stack,
//     );
//     throw new Error(
//       `Invoice and SalesVoucher update failed: ${error.message}`,
//     );
//   } finally {
//     await queryRunner.release();
//   }
// }
