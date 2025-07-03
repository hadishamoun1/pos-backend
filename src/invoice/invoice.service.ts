import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { SalesVoucher } from '../entities/Vouchers/salesVoucher.entity';
import { SalesVoucherDetail } from '../entities/Vouchers/salesVoucherDetails.entity';
import { InvoiceGateway } from './invoice.gateway';
import { Settings } from '../entities/settings.entity';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(SalesVoucher)
    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepo: Repository<InvoiceItem>,

    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepo: Repository<InventoryTransaction>,
  ) {}
  /**
   * ✅ Generate a unique Invoice Number (S25-001 or G25-001)
   */
  async createInvoice(data: any): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Get the active year from settings
      // 1. Get the active year from settings
      const setting = await this.settingsRepo.findOneBy({ isActive: true });
      if (!setting) throw new NotFoundException('Active year not found');

      const yearSuffix = setting.year.slice(-2);
      const isReturn = data.invoiceType === 'RVR';
      const sequencePrefix = 'S'; // 'S' and 'RVR' share the same sequence
      const typePrefix = data.invoiceType; // keep actual type

      // 2. Get the last invoice for type S or RVR
      const lastInvoice = await this.invoiceRepository
        .createQueryBuilder('invoice')
        .where('invoice.invoiceType IN (:...types)', { types: ['S', 'RVR'] })
        .andWhere('invoice.invoiceNumber LIKE :prefix', {
          prefix: `${sequencePrefix}${yearSuffix}-%`,
        })
        .orderBy('invoice.id', 'DESC')
        .getOne();

      let newNumber = 1;
      if (lastInvoice?.invoiceNumber) {
        const parts = lastInvoice.invoiceNumber.split('-');
        const num = parseInt(parts[1]);
        newNumber = num + 1;
      }

      // Use 'S25-00X' even for RVR
      const invoiceNumber = `${sequencePrefix}${yearSuffix}-${String(newNumber).padStart(3, '0')}`;

      // 3. Create and save invoice
      const invoice = this.invoiceRepository.create({
        customerId: data.customerId,
        date: data.date,
        invoiceType: data.invoiceType,
        invoiceNumber,
        documentNumber: data.documentNumber,
        branchId: data.branchId,
        currencyId: data.currencyId,
        totalWithoutVAT: data.totalWithoutVAT,
        totalVAT: data.totalVAT,
        grandTotal: data.grandTotal,
        currencyRate: data.currencyRate,
        vatPercentage: data.vatPercentage,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);

      // 4. Create invoice items
      const items = data.items.map((item) =>
        this.invoiceItemRepo.create({
          invoiceId: savedInvoice.id,
          itemVariantId: item.itemVariantId,
          itemBatchId: item.itemBatchId,
          sqm: item.sqm,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
          vat: item.vat,
          quantity: item.quantity,
        }),
      );

      await queryRunner.manager.save(InvoiceItem, items);

      // 5. Create Inventory Transactions
      const inventoryTransactions = items.map((item) => {
        let quantity = 0;
        let sqm = 0;
        let quantityofr = 0;
        let sqmofr = 0;

        if (data.invoiceType === 'RVR') {
          quantity = -item.quantity;
          sqm = -item.sqm;
        } else if (data.invoiceType === 'G') {
          quantityofr = -item.quantity;
          sqmofr = -item.sqm;
        } else if (data.invoiceType === 'S') {
          quantity = -item.quantity;
          sqm = -item.sqm;
          quantityofr = -item.quantity;
          sqmofr = -item.sqm;
        }

        return this.inventoryTransactionRepo.create({
          transactionType: 'Sales',
          itemVariantId: item.itemVariantId,
          itemBatchId: item.itemBatchId,
          invoiceItemId: item.id,
          quantity,
          sqm,
          quantityofr,
          sqmofr,
          transactionDate: new Date(),
        });
      });

      await queryRunner.manager.save(
        InventoryTransaction,
        inventoryTransactions,
      );

      await queryRunner.commitTransaction();
      return savedInvoice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(error.message || 'Invoice creation failed');
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
