import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, IsNull ,DeepPartial,Brackets, QueryRunner } from 'typeorm';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoiceItem.entity';
import { InvoiceGateway } from './invoice.gateway';
import { Settings } from '../entities/settings.entity';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { Thickness } from 'src/entities/inventory/thickness.entity';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { PurchaseInvoiceItem } from '../entities/Purchase-Invoice/purchase-invoice-item.entity';
import { InventoryCount } from '../entities/inventory/count.entity';
import { SqmPiece } from 'src/entities/inventory/SqmPiece.entity';
import { Request as RequestEntity } from '../entities/request.entity';
import { RequestDetail as RequestDetailEntity } from '../entities/requestDetails.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { AccountingResolverService } from 'src/accountRoleMap/accounting-resolver.service';


@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepo: Repository<InvoiceItem>,

    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepo: Repository<InventoryTransaction>,

    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepo: Repository<JournalVoucher>,

    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepo: Repository<JournalVoucherDetail>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

       @InjectRepository(ItemBatch)
    private readonly itemBatchRepository: Repository<ItemBatch>,

          @InjectRepository(SqmPiece)
    private readonly SqmPieceRepository: Repository<SqmPiece>,

            @InjectRepository(ItemVariant)
    private readonly varientRepo: Repository<ItemVariant>,

                @InjectRepository(RequestDetailEntity)
    private readonly requestDetailRepo: Repository<RequestDetailEntity>,

    private readonly invoiceGateway: InvoiceGateway,
    private readonly accountingResolver: AccountingResolverService, 
    

  ) {}
  


async createInvoice(data: any): Promise<Invoice> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    let deletedRequestId: number | null = null;
    console.log("🟢 Starting invoice creation");

    const setting = await this.settingsRepo.findOneBy({ isActive: true });
    if (!setting) throw new NotFoundException("Active year not found");

    // ✅ ============ CURRENCY LOOKUP START ============
    let currencyId = data.currencyId || 1;
    let currencyCode = "USD";

    if (data.currencyCode) {
      try {
        const Currency = await queryRunner.manager.getRepository("Currency").findOne({
          where: { currencyCode: data.currencyCode },
        });

        if (Currency) {
          currencyId = (Currency as any).id;
          currencyCode = String((Currency as any).currencyCode || "USD").trim().toUpperCase();
          console.log(`💱 Currency: ${currencyCode} -> ID ${currencyId}`);
        } else {
          console.warn(`⚠️ Currency '${data.currencyCode}' not found, using USD`);
        }
      } catch (err) {
        console.error("❌ Currency lookup error:", err);
      }
    }
    // ✅ ============ CURRENCY LOOKUP END ============

    const yearSuffix = setting.year.slice(-2);
    const isReturn = data.invoiceType === "RVR";
    const isG = data.invoiceType === "G";

    const sequencePrefix = isG ? "G" : "S";
    const typesForSeq = isG ? ["G"] : ["S", "RVR"];

    const lastInvoice = await this.invoiceRepository
      .createQueryBuilder("invoice")
      .where("invoice.invoiceType IN (:...types)", { types: typesForSeq })
      .andWhere("invoice.invoiceNumber LIKE :prefix", {
        prefix: `${sequencePrefix}${yearSuffix}-%`,
      })
      .orderBy("invoice.id", "DESC")
      .getOne();

    let newNumber = 1;
    if (lastInvoice?.invoiceNumber) {
      const parts = lastInvoice.invoiceNumber.split("-");
      newNumber = parseInt(parts[1], 10) + 1;
    }

    const invoiceNumber = `${sequencePrefix}${yearSuffix}-${String(newNumber).padStart(3, "0")}`;
    console.log("📄 New invoice number:", invoiceNumber);
    const docNbr = invoiceNumber;

    // ✅ Ensure currencyRate is saved (number + not NaN)
    const invoiceCurrencyRate = Number(data.currencyRate ?? 0);
    if (!Number.isFinite(invoiceCurrencyRate) || invoiceCurrencyRate <= 0) {
      // if USD invoice you might allow rate=1, but never allow 0/NaN
      // if you want to default USD to 1:
      // invoiceCurrencyRate = currencyCode === "USD" ? 1 : invoiceCurrencyRate;
      throw new BadRequestException(`Invalid currencyRate: ${data.currencyRate}`);
    }

    const invoice = this.invoiceRepository.create({
      customerId: data.customerId,
      date: data.date,
      invoiceType: data.invoiceType,
      invoiceNumber,
      documentNumber: data.documentNumber,
      branchId: data.branchId,
      currencyId: currencyId,

      totalWithoutVAT: data.totalWithoutVAT,
      totalVAT: data.totalVAT,
      grandTotal: data.grandTotal,

      // ✅ this is the exchange rate saved on the invoice row
      currencyRate: invoiceCurrencyRate,

      vatPercentage: data.vatPercentage,
    });

    const savedInvoice = await queryRunner.manager.save(invoice);
    console.log("✅ Invoice saved with ID:", savedInvoice.id);

    const items = data.items.map((item: any, index: number) => {
      console.log(`📦 Preparing item[${index}]`, item);

      const isUnit = String(item.type ?? "").trim().toLowerCase() === "unit";

      const qtyForSave = isUnit ? item.sheet : item.quantity;
      const sqmForSave = isUnit ? 0 : item.sqm;

      const unitPriceForSave =
        item.unitPrice != null ? Number(item.unitPrice) : Number(item.price ?? 0);

      const totalAmountForSave = item.totalAmount;

      if (
        sqmForSave === undefined ||
        qtyForSave === undefined ||
        item.itemVariantId === undefined ||
        item.itemBatchId === undefined
      ) {
        console.error(`❌ Missing required field in item[${index}]`, item);
        throw new BadRequestException(`Missing required fields in item[${index}]`);
      }

      const invItem = this.invoiceItemRepo.create({
        invoiceId: savedInvoice.id,
        itemVariantId: item.itemVariantId,
        itemBatchId: item.itemBatchId,
        length: item.length ?? null,
        width: item.width ?? null,
        sheetsPerBox: item.sheetsPerBox ?? null,

        sqm: Number(sqmForSave),

        unitPrice: unitPriceForSave,
        totalAmount: totalAmountForSave,

        vat: item.vat,
        quantity: Number(qtyForSave),

        sqmPieceId:
          item.sqmPieceId != null
            ? Number(item.sqmPieceId)
            : item.sqmPiece && typeof item.sqmPiece.id === "number"
            ? Number(item.sqmPiece.id)
            : null,
      });

      return invItem;
    });

    const savedItems = await queryRunner.manager.getRepository(InvoiceItem).save(items);
    console.log("✅ Saved invoice items:", savedItems.map((i) => i.id));

    const variantIds: number[] = Array.from(
      new Set(savedItems.map((i) => Number(i.itemVariantId)).filter(Boolean)),
    );
    console.log("🔢 Variant IDs in this invoice:", variantIds);

    // -------------- UPDATE SQM PIECES SOLD / REMAINING --------------
    const sqmPieceRepo = queryRunner.manager.getRepository(SqmPiece);

    if (Array.isArray(data.items) && data.items.length > 0) {
      for (let index = 0; index < data.items.length; index++) {
        const src = data.items[index];

        const sqmPieceId: number | undefined =
          src.sqmPieceId ??
          (src.sqmPiece && typeof src.sqmPiece.id === "number" ? src.sqmPiece.id : undefined);

        if (!sqmPieceId) continue;

        const lineSqm = Number(src.sqm);
        if (!Number.isFinite(lineSqm) || lineSqm <= 0) {
          console.warn(
            `⚠ Invoice item[${index}] has sqmPieceId=${sqmPieceId} but invalid sqm=${src.sqm}`,
          );
          continue;
        }

        const piece = await sqmPieceRepo.findOne({ where: { id: sqmPieceId } });
        if (!piece) {
          throw new BadRequestException(`SQM piece ${sqmPieceId} not found for item[${index}].`);
        }

        const remainingBefore = Number(piece.sqmRemaining ?? 0);
        const soldBefore = Number(piece.sqmSold ?? 0);

        if (lineSqm > remainingBefore + 0.0001) {
          throw new BadRequestException(
            `Item[${index + 1}] sqm (${lineSqm.toFixed(
              4,
            )}) exceeds remaining sqm (${remainingBefore.toFixed(4)}) for SQM piece #${sqmPieceId}.`,
          );
        }

        const newRemainingRaw = remainingBefore - lineSqm;
        const newRemaining = newRemainingRaw <= 0.0001 ? 0 : Number(newRemainingRaw.toFixed(4));
        const newSold = Number((soldBefore + lineSqm).toFixed(4));

        piece.sqmRemaining = newRemaining;
        piece.sqmSold = newSold;

        if (newRemaining === 0) piece.isActive = false;

        await sqmPieceRepo.save(piece);
      }
    }

    await this.fillSalesInvoiceAvgCostsFromLastEvent(
      queryRunner,
      new Date(savedInvoice.date),
      savedItems,
    );

    // -------------- INVENTORY TRANSACTIONS --------------
    const stockModeMap = new Map<number, string>();

    if (Array.isArray(variantIds) && variantIds.length > 0) {
      const rows = await queryRunner.manager
        .getRepository(ItemVariant)
        .createQueryBuilder("v")
        .leftJoin("v.thickness", "th")
        .leftJoin("th.item", "item")
        .select("v.id", "id")
        .addSelect("item.stockMode", "stockMode")
        .where("v.id IN (:...ids)", { ids: variantIds })
        .getRawMany();

      for (const r of rows) {
        const id = Number((r as any)?.id);
        const mode = String((r as any)?.stockMode ?? "").trim().toLowerCase();
        if (Number.isFinite(id) && id > 0) stockModeMap.set(id, mode);
      }
    }

    const normalizeStockMode = (m: any) => {
      const s = String(m ?? "").trim().toLowerCase();
      if (s === "unit") return "qty";
      return s || "sqm";
    };

    const inventoryTransactions = (savedItems || [])
      .map((item) => {
        const vId = Number(item.itemVariantId);

        const itemType = String((item as any)?.itemType ?? "").trim().toLowerCase();
        let mode = normalizeStockMode((item as any)?.stockMode ?? stockModeMap.get(vId));
        if (itemType === "unit") mode = "qty";

        if (mode === "none") return null;

        let quantity = 0;
        let sqm = 0;
        let quantityofr = 0;
        let sqmofr = 0;

        const qtyLine = Number(item.quantity) || 0;
        const sqmLine = Number(item.sqm) || 0;

        if (mode === "qty") {
          if (data.invoiceType === "RVR") quantity = -qtyLine;
          else if (data.invoiceType === "G") quantityofr = -qtyLine;
          else if (data.invoiceType === "S") {
            quantity = -qtyLine;
            quantityofr = -qtyLine;
          }
        } else {
          if (data.invoiceType === "RVR") {
            quantity = -qtyLine;
            sqm = -sqmLine;
          } else if (data.invoiceType === "G") {
            quantityofr = -qtyLine;
            sqmofr = -sqmLine;
          } else if (data.invoiceType === "S") {
            quantity = -qtyLine;
            sqm = -sqmLine;
            quantityofr = -qtyLine;
            sqmofr = -sqmLine;
          }
        }

        if (quantity === 0 && sqm === 0 && quantityofr === 0 && sqmofr === 0) return null;

        return queryRunner.manager.getRepository(InventoryTransaction).create({
          transactionType: "Sales",
          itemVariantId: item.itemVariantId,
          itemBatchId: item.itemBatchId,
          invoiceItemId: item.id,
          quantity,
          sqm,
          quantityofr,
          sqmofr,
          transactionDate: new Date(),
          dateForEachInvoice: new Date(savedInvoice.date),
        });
      })
      .filter(Boolean) as InventoryTransaction[];

    if (inventoryTransactions.length) {
      await queryRunner.manager.save(InventoryTransaction, inventoryTransactions);
    }

    //----- UPDATE BATCH OUT/OUTOFR --------------
    const batchRepo = queryRunner.manager.getRepository(ItemBatch);
    const affectedVariantIds = new Set<number>();

    for (const item of savedItems) {
      const batch = await batchRepo.findOne({
        where: { id: item.itemBatchId },
        relations: ["itemVariant"],
      });
      if (!batch) throw new NotFoundException(`ItemBatch ${item.itemBatchId} not found`);

      const variantId = batch.itemVariant?.id ?? item.itemVariantId;
      if (variantId) affectedVariantIds.add(variantId);

      const qtySqm = Number(item.sqm) || 0;

      if (data.invoiceType === "S") {
        batch.out = Number(batch.out ?? 0) + qtySqm;
        batch.outOFR = Number(batch.outOFR ?? 0) + qtySqm;
      } else if (data.invoiceType === "G") {
        batch.outOFR = Number(batch.outOFR ?? 0) + qtySqm;
      } else if (data.invoiceType === "RVR") {
        batch.in = Number(batch.in ?? 0) + qtySqm;
      }

      const start = Number(batch.start ?? 0);
      const inStd = Number(batch.in ?? 0);
      const outStd = Number(batch.out ?? 0);
      const startOfr = Number(batch.startOFR ?? 0);
      const inOfr = Number(batch.inOFR ?? 0);
      const outOfr = Number(batch.outOFR ?? 0);

      batch.balance = Number((start + inStd - outStd).toFixed(2));
      batch.balanceOFR = Number((startOfr + inOfr - outOfr).toFixed(2));

      const chk = ["in", "out", "balance", "inOFR", "outOFR", "balanceOFR"] as const;
      for (const key of chk) {
        if (isNaN((batch as any)[key])) {
          throw new BadRequestException(`Cannot save NaN in ItemBatch.${key} (batchId=${batch.id})`);
        }
      }

      await batchRepo.save(batch);
    }

    // -------------- RECOMPUTE VARIANT TOTALS --------------
    const variantRepo = queryRunner.manager.getRepository(ItemVariant);
    for (const variantId of affectedVariantIds) {
      const variant = await variantRepo.findOne({
        where: { id: variantId },
        relations: ["batches"],
      });
      if (!variant) continue;

      let totalStart = 0;
      let totalIn = 0;
      let totalOut = 0;
      let totalStartOFR = 0;
      let totalInOFR = 0;
      let totalOutOFR = 0;

      for (const b of variant.batches ?? []) {
        totalStart += Number(b.start || 0);
        totalIn += Number(b.in || 0);
        totalOut += Number(b.out || 0);
        totalStartOFR += Number(b.startOFR || 0);
        totalInOFR += Number(b.inOFR || 0);
        totalOutOFR += Number(b.outOFR || 0);
      }

      variant.totalStart = Number(totalStart.toFixed(2));
      variant.totalIn = Number(totalIn.toFixed(2));
      variant.totalOut = Number(totalOut.toFixed(2));
      variant.totalBalance = Number((totalStart + totalIn - totalOut).toFixed(2));

      variant.totalStartOFR = Number(totalStartOFR.toFixed(2));
      variant.totalInOFR = Number(totalInOFR.toFixed(2));
      variant.totalOutOFR = Number(totalOutOFR.toFixed(2));
      variant.totalBalanceOFR = Number((totalStartOFR + totalInOFR - totalOutOFR).toFixed(2));

      await variantRepo.save(variant);
    }

    // -------------------- JV (✅ FIXED: saves invoice exchange rate into JV DETAILS) --------------------
    const jvPrefix = isG ? "JVG" : "JV";
    const lastJV = await this.journalVoucherRepo
      .createQueryBuilder("jv")
      .where("jv.jvNumber LIKE :prefix", {
        prefix: `${jvPrefix}${yearSuffix}-%`,
      })
      .orderBy("jv.id", "DESC")
      .getOne();

    const jvSequence = lastJV?.jvNumber ? parseInt(lastJV.jvNumber.split("-")[1]) + 1 : 1;
    const jvNumber = `${jvPrefix}${yearSuffix}-${String(jvSequence).padStart(3, "0")}`;

    const useVAT = Number(data.vatPercentage) > 0;

    // ✅ IMPORTANT: Use the SAVED invoice rate (guaranteed persisted)
    const rate = Number(savedInvoice.currencyRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException(`Invalid saved invoice currencyRate: ${savedInvoice.currencyRate}`);
    }

    // ✅ store rate on each JV line (you already have exRateUSD column)
    const addRateFields = () => ({
      exRateUSD: rate,
      exRateEUROToUSD: 0,
    });

    // Assumption: rate = LL per 1 USD
    const toUsdLl = (amountInInvoiceCurrency: number) => {
      const a = Number(amountInInvoiceCurrency) || 0;
      if (currencyCode === "USD") return { usd: a, ll: a * rate };
      if (currencyCode === "LL") return { usd: a / rate, ll: a };
      return { usd: a, ll: a * rate };
    };

    const salesRole = currencyCode === "USD" ? "Sales_USD" : "Sales_LL";
    const vatRole = currencyCode === "USD" ? "Vat_USD" : "Vat_LL";

    const salesAccount = await this.accountingResolver.resolveAccount(salesRole, null);
    const vatAccount = useVAT ? await this.accountingResolver.resolveAccount(vatRole, null) : null;

    const total = Number(data.grandTotal) || 0;
    const totalWithoutVAT = Number(data.totalWithoutVAT) || 0;
    const totalVAT = Number(data.totalVAT) || 0;

    const details: JournalVoucherDetail[] = [];

    const getJVFields = (type: "dr" | "cr", amount: number): Partial<JournalVoucherDetail> => {
      const { usd, ll } = toUsdLl(amount);

      const fields: any = {
        dr: 0, drUSD: 0, drLL: 0, drOFR: 0, drUSDOFR: 0, drLLOFR: 0,
        cr: 0, crUSD: 0, crLL: 0, crOFR: 0, crUSDOFR: 0, crLLOFR: 0,
      };

      if (type === "dr") {
        if (isG) {
          fields.drOFR = amount;
          fields.drUSDOFR = usd;
          fields.drLLOFR = ll;
        } else if (isReturn) {
          fields.dr = amount;
          fields.drUSD = usd;
          fields.drLL = ll;
        } else {
          fields.dr = amount;
          fields.drUSD = usd;
          fields.drLL = ll;
          fields.drOFR = amount;
          fields.drUSDOFR = usd;
          fields.drLLOFR = ll;
        }
      } else {
        if (isG) {
          fields.crOFR = amount;
          fields.crUSDOFR = usd;
          fields.crLLOFR = ll;
        } else if (isReturn) {
          fields.cr = amount;
          fields.crUSD = usd;
          fields.crLL = ll;
        } else {
          fields.cr = amount;
          fields.crUSD = usd;
          fields.crLL = ll;
          fields.crOFR = amount;
          fields.crUSDOFR = usd;
          fields.crLLOFR = ll;
        }
      }

      return fields;
    };

    // DR: Customer
    details.push(
      this.journalVoucherDetailRepo.create({
        customerId: data.customerId,
        description: "فاتورة",
        currency: currencyCode,
        docNbr,
        ...addRateFields(),              // ✅ SAVED HERE
        ...getJVFields("dr", total),
      }),
    );

    // CR: Sales
    const salesCrAmount = isG ? totalWithoutVAT + totalVAT : totalWithoutVAT;

    details.push(
      this.journalVoucherDetailRepo.create({
        accountId: salesAccount.id,
        description: "مبيعات خاضعة للضريبة على القيمة المضافة",
        currency: currencyCode,
        docNbr,
        ...addRateFields(),              // ✅ SAVED HERE
        ...getJVFields("cr", salesCrAmount),
      }),
    );

    // CR: VAT
    if (useVAT && vatAccount && !isG) {
      details.push(
        this.journalVoucherDetailRepo.create({
          accountId: vatAccount.id,
          description: "ضريبة القيمة المضافة - مبيع VAT",
          currency: currencyCode,
          docNbr,
          ...addRateFields(),            // ✅ SAVED HERE
          ...getJVFields("cr", totalVAT),
        }),
      );
    }

    const sum = (field: keyof JournalVoucherDetail) =>
      details.reduce((acc, entry) => acc + Number((entry as any)[field] || 0), 0);

    const journalVoucher = this.journalVoucherRepo.create({
      jvNumber,
      jvType: data.invoiceType,
      date: data.date,

      totalDr: sum("dr"),
      totalDrUSD: sum("drUSD"),
      totalDrLL: sum("drLL"),
      totalDrOFR: sum("drOFR"),
      totalDrUSDOFR: sum("drUSDOFR"),
      totalDrLLOFR: sum("drLLOFR"),

      totalCr: sum("cr"),
      totalCrUSD: sum("crUSD"),
      totalCrLL: sum("crLL"),
      totalCrOFR: sum("crOFR"),
      totalCrUSDOFR: sum("crUSDOFR"),
      totalCrLLOFR: sum("crLLOFR"),

      details,
    });

    await queryRunner.manager.save(JournalVoucher, journalVoucher);
    console.log("✅ Journal voucher saved:", jvNumber);

    console.log("🧾 payload.requestId =", data.requestId, "type=", typeof data.requestId);

    // ✅ Delete request if provided
    if (data.requestId != null && String(data.requestId).trim() !== "") {
      const reqId = Number(data.requestId);

      console.log("🗑️ attempting delete requestId=", reqId);

      if (!Number.isInteger(reqId) || reqId <= 0) {
        throw new BadRequestException(`Invalid requestId: ${data.requestId}`);
      }

      const reqRepo = queryRunner.manager.getRepository(RequestEntity);
      const reqDetailRepo = queryRunner.manager.getRepository(RequestDetailEntity);

      const delDetails = await reqDetailRepo
        .createQueryBuilder()
        .delete()
        .from(RequestDetailEntity)
        .where("requestId = :reqId", { reqId })
        .execute();

      console.log("🧹 deleted request_details affected =", delDetails.affected);

      const delReq = await reqRepo
        .createQueryBuilder()
        .delete()
        .from(RequestEntity)
        .where("id = :reqId", { reqId })
        .execute();

      console.log("🧨 deleted request header affected =", delReq.affected);

      if (!delReq.affected) {
        throw new BadRequestException(`Request ${reqId} was not deleted (not found in DB/table).`);
      }

      deletedRequestId = reqId;
      console.log(`✅ Deleted Request #${reqId} after invoice #${savedInvoice.id}`);
    }

    await queryRunner.commitTransaction();

    if (deletedRequestId) {
      this.invoiceGateway.emitRequestRemoved(deletedRequestId);
    }

    const forList = await this.invoiceRepository.findOne({
      where: { id: savedInvoice.id },
      relations: ["customer"],
    });

    this.invoiceGateway.emitNewInvoice({
      id: forList?.id ?? savedInvoice.id,
      invoiceNumber: forList?.invoiceNumber ?? savedInvoice.invoiceNumber,
      date: forList?.date ?? savedInvoice.date,
      grandTotal: forList?.grandTotal ?? savedInvoice.grandTotal,
      customerName:
        (forList as any)?.customer?.customerName ??
        (forList as any)?.customerName ??
        "Unknown",
    });

    console.log("🎉 Invoice creation complete");
    return savedInvoice;
  } catch (error: any) {
    console.error("❌ Invoice creation failed:", error.message);
    await queryRunner.rollbackTransaction();
    throw new BadRequestException(error.message || "Invoice creation failed");
  } finally {
    await queryRunner.release();
  }
}





private async fillSalesInvoiceAvgCostsFromLastEvent(
  queryRunner: QueryRunner,
  invoiceDate: Date,
  savedItems: InvoiceItem[],
) {
  const TAG = `[SALES-AVG-SNAPSHOT]`;

  if (!savedItems?.length) return;

  const cut = new Date(invoiceDate);
  cut.setHours(23, 59, 59, 999);
  const cutStr = cut.toISOString().slice(0, 10); // for DATE columns

  const txRepo = queryRunner.manager.getRepository(InventoryTransaction);
  const piiRepo = queryRunner.manager.getRepository(PurchaseInvoiceItem);
  const tiRepo = queryRunner.manager.getRepository(TransferItem);
  const icRepo = queryRunner.manager.getRepository(InventoryCount);
  const vRepo = queryRunner.manager.getRepository(ItemVariant);

  const toNumOrNull = (v: any): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const safeAvgOrNull = (sumVal: number, sumQty: number) => {
    if (!Number.isFinite(sumVal) || !Number.isFinite(sumQty) || sumQty <= 0) return null;
    return sumVal / sumQty;
  };

  const uniqVariantIds = Array.from(
    new Set(savedItems.map((i) => Number(i.itemVariantId)).filter(Boolean)),
  );

  type AvgBundle = {
    averageCost: number | null;
    averageCostVM: number | null;
    averageCostC: number | null;
    averageCostCVM: number | null;
  };

  const cache = new Map<number, AvgBundle>();

  for (const variantId of uniqVariantIds) {
    // ✅ last event before this invoice date
    const lastTx = await txRepo
      .createQueryBuilder('tx')
      .where('tx.itemVariantId = :variantId', { variantId })
      .andWhere('tx.dateForEachInvoice <= :cut', { cut: cutStr })
      .andWhere(
        new Brackets((b) => {
          b.where('tx.purchaseInvoiceItemId IS NOT NULL')
            .orWhere('tx.transferId IS NOT NULL')
            .orWhere('tx.inventoryCountId IS NOT NULL');
        }),
      )
      .orderBy('tx.dateForEachInvoice', 'DESC')
      .addOrderBy('tx.id', 'DESC')
      .getOne();

    let bundle: AvgBundle = {
      averageCost: null,
      averageCostVM: null,
      averageCostC: null,
      averageCostCVM: null,
    };

    if (lastTx?.purchaseInvoiceItemId) {
      // ✅ last event = PO → take avg costs directly from that PO row
      const pii = await piiRepo.findOne({
        where: { id: Number(lastTx.purchaseInvoiceItemId) } as any,
      });

      if (pii) {
        bundle = {
          averageCost: toNumOrNull((pii as any).averageCost),
          averageCostVM: toNumOrNull((pii as any).averageCostVM),
          averageCostC: toNumOrNull((pii as any).averageCostC),
          averageCostCVM: toNumOrNull((pii as any).averageCostCVM),
        };
      }
    } else if (lastTx?.transferId) {
      // ✅ last event = Transfer → take avg costs from TransferItem
      const where: any = {
        transferId: Number(lastTx.transferId),
        itemVariantId: Number(variantId),
      };
      // if your tx stores itemBatchId, this makes it even more accurate
      if ((lastTx as any).itemBatchId) where.itemBatchId = Number((lastTx as any).itemBatchId);

      const ti = await tiRepo.findOne({ where });

      if (ti) {
        bundle = {
          averageCost: toNumOrNull((ti as any).averageCost),
          averageCostVM: toNumOrNull((ti as any).averageCostVM),
          averageCostC: toNumOrNull((ti as any).averageCostC),
          averageCostCVM: toNumOrNull((ti as any).averageCostCVM),
        };
      }
    } else if (lastTx?.inventoryCountId) {
      // ✅ last event = InventoryCount / OpeningCount
      // your rule:
      // finalCostOfr = averageCost (base)
      // finalCost    = averageCostVM
      const ic = await icRepo.findOne({
        where: { id: Number(lastTx.inventoryCountId) } as any,
      });

      if (ic) {
        bundle.averageCost = toNumOrNull((ic as any).finalCostOfr);
        bundle.averageCostVM = toNumOrNull((ic as any).finalCost);

        // ✅ derive C / CVM from InventoryCount like your PO fallback (DESC-level weighted avg)
        const v = await vRepo.findOne({
          where: { id: variantId } as any,
          select: ['id', 'itemNameDescriptionId'] as any,
        });

        const descId = Number((v as any)?.itemNameDescriptionId || 0);
        if (descId) {
          const descVariantRows = await vRepo
            .createQueryBuilder('v')
            .select(['v.id AS id'])
            .where('v.itemNameDescriptionId = :d', { d: descId })
            .getRawMany();

          const descVariantIds = Array.from(
            new Set((descVariantRows || []).map((r: any) => Number(r.id)).filter(Boolean)),
          );

          if (descVariantIds.length) {
            const raw = await icRepo
              .createQueryBuilder('ic')
              .select('SUM(COALESCE(ic.sqmOfr,0))', 'sumQtyOfr')
              .addSelect('SUM(COALESCE(ic.sqmOfr,0) * COALESCE(ic.finalCostOfr,0))', 'sumValOfr')
              .addSelect('SUM(COALESCE(ic.sqm,0))', 'sumQtyVm')
              .addSelect('SUM(COALESCE(ic.sqm,0) * COALESCE(ic.finalCost,0))', 'sumValVm')
              .where('ic.itemVariantId IN (:...ids)', { ids: descVariantIds })
              .andWhere('ic.date <= :cut', { cut: cutStr })
              .getRawOne<any>();

            const sumQtyOfr = Number(raw?.sumQtyOfr ?? 0);
            const sumValOfr = Number(raw?.sumValOfr ?? 0);
            const sumQtyVm = Number(raw?.sumQtyVm ?? 0);
            const sumValVm = Number(raw?.sumValVm ?? 0);

            bundle.averageCostC = safeAvgOrNull(sumValOfr, sumQtyOfr);   // C uses OFR lane
            bundle.averageCostCVM = safeAvgOrNull(sumValVm, sumQtyVm);   // CVM uses VM lane
          }
        }
      }
    }

    cache.set(variantId, bundle);
  }

  // ✅ apply to invoice items (NO siblings, per-variant)
  for (const ii of savedItems) {
    const vid = Number(ii.itemVariantId);
    const b = cache.get(vid);
    if (!b) continue;

    ii.averageCost = b.averageCost;
    ii.averageCostVM = b.averageCostVM;
    ii.averageCostC = b.averageCostC;
    ii.averageCostCVM = b.averageCostCVM;

    // you said: no need for last cost in snapshot
    ii.lastCost = null;
    ii.lastCostVM = null;
    ii.lastCostC = null;
    ii.lastCostCVM = null;
  }

  await queryRunner.manager.save(InvoiceItem, savedItems);
  console.log(`${TAG} done`, { count: savedItems.length, cut: cutStr });
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
      "customer",
      "customer.currency",
      "customer.account",
      "currency", // ✅ ADDED: Load invoice's own currency
      "items",
      "items.itemVariant",
      "items.itemVariant.itemNameDescription",
      "items.itemVariant.thickness",
      "items.itemVariant.thickness.item",
      "items.itemBatch",
    ],
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  const cust = invoice.customer;

  const toNumOrNull = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return {
    // ===== Invoice (top-level) =====
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
    currencyCode: invoice.currency?.currencyCode ?? cust?.currency?.currencyCode ?? 'USD', // ✅ FIXED: Invoice currency first, fallback to customer

    // ===== Customer (flat fields for preview convenience) =====
    customerId: cust?.id ?? null,
    customerName: cust?.customerName ?? null,
    customerInvoiceType: cust?.invoiceType ?? null,
    customerAccountNumber: cust?.customerAccountNumber ?? null,
    customerAddress: cust?.address ?? null,
    customerPhone: cust?.phoneNumber ?? null,
    customerTaxNumber: cust?.financialNumber ?? null,
    customerPaymentTerms: cust?.paymentTerms ?? null,
    customerArea: cust?.area ?? null,
    customerCompanyType: cust?.companyType ?? null,
    customerVatDefault: cust?.vat ?? null,

    // ===== Customer (full nested object) =====
    customer: cust
      ? {
          id: cust.id,
          customerAccountNumber: cust.customerAccountNumber,
          customerName: cust.customerName,
          firstName: (cust as any).firstName ?? null,
          middleName: (cust as any).middleName ?? null,
          paymentTerms: cust.paymentTerms ?? null,
          area: cust.area ?? null,
          companyType: cust.companyType ?? null,
          address: cust.address ?? null,
          phoneNumber: cust.phoneNumber ?? null,
          financialNumber: cust.financialNumber ?? null,
          invoiceType: cust.invoiceType ?? null,
          vat: cust.vat ?? null,
          currencyId: cust.currencyId ?? cust.currency?.id ?? null,
          currency: cust.currency
            ? {
                id: cust.currency.id,
                currencyCode: cust.currency.currencyCode,
                currencyName: cust.currency.currencyName,
              }
            : null,
          account: cust.account
            ? {
                id: cust.account.id,
                accountNumber: cust.account.accountNumber,
                accountName: cust.account.accountName,
                parentNumber: cust.account.parentNumber,
                arabicAccountName: cust.account.arabicAccountName,
                accessible: cust.account.accessible,
              }
            : null,
        }
      : null,

    // ===== Items =====
    items: (invoice.items || []).map((item) => {
      const variant = (item as any).itemVariant;
      const thickness = variant?.thickness;
      const itemData = thickness?.item;
      const batch = (item as any).itemBatch ?? null;
      const itemNameDescription = variant?.itemNameDescription ?? null;

      const itemType = itemData?.type ?? null;
      const stockMode = (itemData as any)?.stockMode ?? null;

      const rawLen = (item as any).length;
      const rawWid = (item as any).width;
      const rawSpb = (item as any).sheetsPerBox;

      const length = toNumOrNull(rawLen);
      const width = toNumOrNull(rawWid);

      let sheetsPerBox: number | null = null;
      if (String(itemType || "").toLowerCase() === "box") {
        sheetsPerBox = toNumOrNull(rawSpb);
      }

      const originalLength = toNumOrNull((variant as any)?.length);
      const originalWidth = toNumOrNull((variant as any)?.width);
      const originalSheetsPerBox =
        String(itemType || "").toLowerCase() === "box" ? toNumOrNull((variant as any)?.sheetsPerBox) : null;

      let totalSheets: number | null = null;
      const qty = Number((item as any)?.quantity ?? 0) || 0;
      if (String(itemType || "").toLowerCase() === "box") {
        totalSheets = qty * (Number(sheetsPerBox ?? 0) || 0);
      } else if (String(itemType || "").toLowerCase() === "sheet" || String(itemType || "").toLowerCase() === "unit") {
        totalSheets = qty;
      }

      const fkBatchId = toNumOrNull((item as any).itemBatchId);
      const relBatchId = toNumOrNull(batch?.id);
      const itemBatchId = fkBatchId ?? relBatchId ?? null;

      if (!itemBatchId) {
        console.warn("⚠️ Invoice item missing itemBatchId:", {
          invoiceId: invoice.id,
          invoiceItemId: (item as any)?.id,
          itemVariantId: (item as any)?.itemVariantId,
          fkItemBatchId: (item as any)?.itemBatchId,
          relBatchId: batch?.id,
          itemType,
        });
      }

      const sqmpieceId = (item as any).sqmPieceId ?? null;
      const itemNumber = itemNameDescription?.itemNumber ?? null;

      return {
        invoiceItemId: item.id,
        sqm: item.sqm,
        unitPrice: item.unitPrice,
        totalAmount: item.totalAmount,
        vat: item.vat,
        quantity: item.quantity,

        itemBatchId,

        itemVariantId: variant?.id ?? null,
        itemName: itemData?.itemName ?? null,
        itemNumber,
        itemType,
        stockMode,

        thickness: thickness?.thickness ?? null,

        length,
        width,

        origin: variant?.origin ?? null,
        sqmpieceId,

        invoiceDisplayName: variant?.invoiceDisplayName ?? null,

        sheetsPerBox,
        totalSheets,

        originalLength,
        originalWidth,
        originalSheetsPerBox,

        fixBox: (variant as any)?.fixBox ?? null,
        fixLength: (variant as any)?.fixLength ?? null,
        fixWidth: (variant as any)?.fixWidth ?? null,

        batch: batch
          ? {
              id: batch.id,
              condition: batch.condition ?? null,
              dateReceived: batch.dateReceived ?? null,
              start: batch.start ?? null,
              in: batch.in ?? null,
              out: batch.out ?? null,
              balance: batch.balance ?? null,
              startOFR: batch.startOFR ?? null,
              inOFR: batch.inOFR ?? null,
              outOFR: batch.outOFR ?? null,
              balanceOFR: batch.balanceOFR ?? null,
            }
          : null,
      };
    }),
  };
}



 async getFilteredInvoices(
  page: number,
  limit: number,
): Promise<{ data: any[]; total: number; totalPages: number }> {
  const pageNum = Number.isFinite(page)  && page  > 0 ? page  : 1;
  const take    = Number.isFinite(limit) && limit > 0 ? limit : 100;
  const skip    = (pageNum - 1) * take;

  const [invoices, total] = await this.invoiceRepository.findAndCount({
    relations: ['customer'],
    order: { id: 'DESC' },
    skip,
    take,
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
    totalPages: Math.ceil(total / take),
  };
}


 


async getBrowsingInvoices(
  customerId: number,
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // = realDescriptionId as string
) {
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.realDescription', // ok to keep; not required for grouping
    ],
    order: { date: 'DESC' },
  });

  const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const nullLast = (v: any) =>
    v == null || Number.isNaN(Number(v)) ? Number.POSITIVE_INFINITY : Number(v);
  const toTime = (d: any) => {
    const t = new Date(d as any).getTime();
    return Number.isFinite(t) ? t : -Infinity;
  };

  const rows = invoices.flatMap((inv) =>
    (inv.items || []).map((it) => {
      const variant = it.itemVariant;
      const th = variant?.thickness;
      const item = th?.item;

      // ✅ group using FK column directly
      const realId = Number((variant as any)?.realDescriptionId ?? 0);
      const real   = (variant as any)?.realDescription;

      const length =
        (variant as any)?.length ??
        (variant as any)?.dimensions?.length ??
        null;

      const width =
        (variant as any)?.width ??
        (variant as any)?.dimensions?.width ??
        null;

      // Label from relation if present; otherwise fallback
      const descriptionName = real
        ? [real.categoryName, real.subCategory, real.colorName, real.designName]
            .filter(Boolean)
            .join(' | ')
        : '(No Description)';

      return {
        realDescriptionId: realId,               // ✅ key
        invoiceDate: inv.date,
        invoiceNumber: inv.invoiceNumber,
        itemName: item?.itemName || '',
        descriptionName,
        itemSortIndex: (item as any)?.sortIndex ?? (item as any)?.sort_index ?? null,
        thickness: th?.thickness ?? '',
        thicknessSortIndex: (th as any)?.sort_index ?? (th as any)?.sortIndex ?? null,
        origin: variant?.origin ?? '',
        length,
        width,
        type: item?.type || '',
        box: item?.type === 'box' ? it.quantity : 0,
        sheet: item?.type === 'sheet' ? it.quantity : 0,
        sheetsPerBox: item?.type === 'box' ? variant?.sheetsPerBox || 0 : null,
        sqm: it.sqm,
        unitPrice: it.unitPrice,
        vat: it.vat,
        totalAmount: it.totalAmount,
        itemVariantId: variant?.id || 0,
        itemBatchId: it.itemBatch?.id || 0,
      };
    })
  );

  // Group by realDescriptionId (string keys for consistency)
  const grouped = new Map<string, any[]>();
  for (const r of rows) {
    const k = String(r.realDescriptionId ?? 0);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(r);
  }

  const cmpWithinGroup = (a: any, b: any) => {
    const aItemIdx = nullLast(a.itemSortIndex);
    const bItemIdx = nullLast(b.itemSortIndex);
    if (aItemIdx !== bItemIdx) return aItemIdx - bItemIdx;

    const nameCmp = String(a.itemName || '').localeCompare(String(b.itemName || ''));
    if (nameCmp !== 0) return nameCmp;

    const aThIdx = nullLast(a.thicknessSortIndex);
    const bThIdx = nullLast(b.thicknessSortIndex);
    if (aThIdx !== bThIdx) return aThIdx - bThIdx;

    const aTh = toNum(a.thickness);
    const bTh = toNum(b.thickness);
    if (aTh !== bTh) return aTh - bTh;

    const bt = toTime(b.invoiceDate);
    const at = toTime(a.invoiceDate);
    if (bt !== at) return bt - at;

    return String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || ''));
  };

  const buildGroup = (key: string, items: any[], page = 1) => {
    const ordered = [...items].sort(cmpWithinGroup);
    const start = (page - 1) * limitPerGroup;
    const slice = ordered.slice(start, start + limitPerGroup);

    const latestInvoiceDate = ordered.length
      ? ordered.reduce(
          (max, r) => (toTime(r.invoiceDate) > toTime(max) ? r.invoiceDate : max),
          ordered[0].invoiceDate,
        )
      : null;

    return {
      groupKey: key,
      descriptionName: items[0]?.descriptionName || '',
      items: slice,
      total: ordered.length,
      page,
      totalPages: Math.ceil(ordered.length / limitPerGroup),
      latestInvoiceDate,
    };
  };

  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return buildGroup(groupKey, items, pagePerGroup);
  }

  const groups = Array.from(grouped.entries()).map(([key, items]) =>
    buildGroup(key, items, 1),
  );
  groups.sort((A, B) => toTime(B.latestInvoiceDate) - toTime(A.latestInvoiceDate));
  return groups.map(({ latestInvoiceDate, ...rest }) => rest);
}



  


async getBrowsingInvoicesByItemBatches(
  customerId: number,
  itemBatchIds: number[],
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // realDescriptionId as string
) {
  // 1) Resolve selected batches -> their realDescriptionIds
  const batches = await this.itemBatchRepository.find({
    where: { id: In(itemBatchIds) },
    relations: [
      'itemVariant',
      'itemVariant.realDescription',          // ⬅️ switched
      'itemVariant.thickness',
      'itemVariant.thickness.item',
    ],
  });

  const realDescriptionIds = Array.from(
    new Set(
      batches
        .map(b => b.itemVariant?.realDescription?.id)
        .filter((id): id is number => !!id)
    )
  );

  if (realDescriptionIds.length === 0) {
    return groupKey
      ? {
          groupKey,
          descriptionName: '',
          items: [],
          total: 0,
          page: pagePerGroup,
          totalPages: 0,
        }
      : [];
  }

  // 2) Fetch invoices for this customer (load realDescription, not itemNameDescription)
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.realDescription',    // ⬅️ switched
    ],
    order: { date: 'DESC' },
  });

  const toMs = (d: any) => {
    const ms = Date.parse(typeof d === 'string' ? d : String(d));
    return Number.isFinite(ms) ? ms : -Infinity;
  };

  // 3) Flatten & filter (by realDescription)
  const allItems = invoices.flatMap((invoice) =>
    (invoice.items || [])
      .filter((it) => {
        const realId = it.itemVariant?.realDescription?.id ?? 0;
        return realId && realDescriptionIds.includes(realId);
      })
      .map((item) => {
        const variant = item.itemVariant;
        const th = variant?.thickness;
        const itm = th?.item;
        const real = variant?.realDescription;
        const type = itm?.type || '';

        const length =
          (variant as any)?.length ??
          (variant as any)?.dimensions?.length ??
          null;

        const width =
          (variant as any)?.width ??
          (variant as any)?.dimensions?.width ??
          null;

        // Build a nice label from real description fields
        const descriptionName = real
          ? [real.categoryName, real.subCategory, real.colorName, real.designName]
              .filter(Boolean)
              .join(' | ')
          : '(No Description)';

        return {
          // grouping identity (REAL)
          realDescriptionId: real?.id || 0,

          // fields used in UI
          invoiceDate: invoice.date,
          invoiceDateMs: toMs(invoice.date),
          invoiceNumber: invoice.invoiceNumber,
          itemName: itm?.itemName || '',
          descriptionName,
          thickness: th?.thickness ?? '',
          origin: variant?.origin ?? '',
          type,
          box: type === 'box' ? item.quantity : 0,
          sheet: type === 'sheet' ? item.quantity : 0,
          sheetsPerBox: type === 'box' ? variant?.sheetsPerBox || 0 : null,
          sqm: item.sqm,
          unitPrice: item.unitPrice,
          vat: item.vat,
          totalAmount: item.totalAmount,
          length,
          width,
          itemVariantId: variant?.id || 0,
          itemBatchId: item.itemBatch?.id || 0,
        };
      })
  );

  // 4) Group by realDescriptionId
  const grouped = new Map<string, any[]>();
  for (const row of allItems) {
    const key = String(row.realDescriptionId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  // Helper: build one group page with items sorted by date DESC
  const pageGroup = (key: string, items: any[]) => {
    const sortedByDateDesc = items
      .slice()
      .sort((a, b) => (b.invoiceDateMs ?? -Infinity) - (a.invoiceDateMs ?? -Infinity));

    const start = (pagePerGroup - 1) * limitPerGroup;
    return {
      groupKey: key,
      descriptionName: sortedByDateDesc[0]?.descriptionName || '',
      items: sortedByDateDesc.slice(start, start + limitPerGroup),
      total: sortedByDateDesc.length,
      page: pagePerGroup,
      totalPages: Math.ceil(sortedByDateDesc.length / limitPerGroup),
      latestInvoiceDate: sortedByDateDesc[0]?.invoiceDate ?? null,
      latestInvoiceMs: sortedByDateDesc[0]?.invoiceDateMs ?? -Infinity,
    };
  };

  // Single-group pagination request
  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return pageGroup(groupKey, items);
  }

  // 5) Build first page per group
  const groups = Array.from(grouped.entries()).map(([key, items]) =>
    pageGroup(key, items)
  );

  // 6) Order groups by latest item date (newest group first)
  groups.sort((A, B) => (B.latestInvoiceMs ?? -Infinity) - (A.latestInvoiceMs ?? -Infinity));

  return groups;
}





// search items 

  private toNum(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private nullLast(n: any): number {
    return n == null || Number.isNaN(Number(n)) ? Number.POSITIVE_INFINITY : Number(n);
  }

  /** Convert Arabic-Indic digits to Western so ٥.٥ becomes 5.5, ٠٢٥ => 025 */
  private normalizeArabicDigits(s: string): string {
    if (!s) return s;
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    };
    return s.replace(/[٠-٩]/g, (d) => map[d] ?? d);
  }

  /** Exact same ordering you already use (copy your function here) */
  private orderLikeItemsService(rows: any[]) {
    const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const nullLast = (n: any) =>
      n == null || Number.isNaN(Number(n)) ? Number.POSITIVE_INFINITY : Number(n);

    // 1) group by itemName
    const byItem = new Map<string, any[]>();
    for (const r of rows) {
      const key = r.itemName ?? '';
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key)!.push(r);
    }

    // items: item.sortIndex NULLS LAST, then name ASC
    const itemKeys = Array.from(byItem.keys()).sort((a, b) => {
      const aArr = byItem.get(a)!;
      const bArr = byItem.get(b)!;
      const minSortA = Math.min(...aArr.map((x) => nullLast(x.itemSortIndex)));
      const minSortB = Math.min(...bArr.map((x) => nullLast(x.itemSortIndex)));
      if (minSortA !== minSortB) return minSortA - minSortB;
      return a.localeCompare(b);
    });

    const orderedAll: any[] = [];

    for (const itemKey of itemKeys) {
      const rowsOfItem = byItem.get(itemKey)!;

      // 2) group by thickness value
      const byTh = new Map<number, any[]>();
      for (const r of rowsOfItem) {
        const th = toNum(r.thickness);
        if (!byTh.has(th)) byTh.set(th, []);
        byTh.get(th)!.push(r);
      }

      // thickness: thickness.sort_index NULLS LAST, then numeric thickness ASC
      const thKeys = Array.from(byTh.keys()).sort((ta, tb) => {
        const aArr = byTh.get(ta)!;
        const bArr = byTh.get(tb)!;
        const minSortA = Math.min(...aArr.map((x) => nullLast(x.thicknessSortIndex)));
        const minSortB = Math.min(...bArr.map((x) => nullLast(x.thicknessSortIndex)));
        if (minSortA !== minSortB) return minSortA - minSortB;
        return ta - tb;
      });

      for (const th of thKeys) {
        const rowsTh = byTh.get(th)!;

        // 3) dims vs non-dims
        const hasDims = (r: any) => toNum(r.length) > 0 && toNum(r.width) > 0;
        const dimmed = rowsTh.filter(hasDims);
        const nonDimmed = rowsTh.filter((r) => !hasDims(r) || r.type === 'sqm');

        // group dimmed by L|W
        const byDims = new Map<string, any[]>();
        for (const r of dimmed) {
          const k = `${toNum(r.length)}|${toNum(r.width)}`;
          if (!byDims.has(k)) byDims.set(k, []);
          byDims.get(k)!.push(r);
        }

        // dims order: area DESC → L DESC → W DESC
        const dimKeys = Array.from(byDims.keys()).sort((ka, kb) => {
          const [aL, aW] = ka.split('|').map(Number);
          const [bL, bW] = kb.split('|').map(Number);
          const aArea = aL * aW, bArea = bL * bW;
          if (aArea !== bArea) return bArea - aArea;
          if (aL !== bL) return bL - aL;
          return bW - aW;
        });

        // per dims group: box (SPB DESC) → sheet → sqm
        for (const dk of dimKeys) {
          const g = byDims.get(dk)!;

          const boxes = g
            .filter((x) => x.type === 'box')
            .sort(
              (a, b) =>
                (toNum(b.sheetsPerBox) || 0) - (toNum(a.sheetsPerBox) || 0) ||
                toNum(a.itemVariantId) - toNum(b.itemVariantId),
            );
          const sheets = g
            .filter((x) => x.type === 'sheet')
            .sort((a, b) => toNum(a.itemVariantId) - toNum(b.itemVariantId));
          const sqms = g.filter((x) => x.type === 'sqm');

          orderedAll.push(...boxes, ...sheets, ...sqms);
        }

        // then sqm without dims (variantId), then no-dims non-sqm
        const sqmOthers = nonDimmed
          .filter((x) => x.type === 'sqm')
          .sort((a, b) => toNum(a.itemVariantId) - toNum(b.itemVariantId));
        const noDimsNonSqm = nonDimmed.filter((x) => x.type !== 'sqm');

        orderedAll.push(...sqmOthers, ...noDimsNonSqm);
      }
    }

    return orderedAll;
  }

  /**
   * Parse the free-text query.
   * Supports:
   *  - words for name (e.g., "ابيض")
   *  - thickness: "5.5ملم" or "5ملم"
   *  - dims: "225*321" and optional box SPB "225*321-025" (=> type=box, sheetsPerBox=25)
   */
  private parseSearchQuery(qRaw: string) {
    const q = this.normalizeArabicDigits((qRaw || '').trim());
    const out: {
      nameTokens: string[];
      thickness?: number;
      dims?: { length: number; width: number; spb?: number };
      impliedType?: 'box' | 'sheet' | 'sqm';
    } = { nameTokens: [] };

    if (!q) return out;

    // thickness: e.g., "5.5ملم" or "5ملم"
    const thMatch = q.match(/(\d+(?:\.\d+)?)\s*ملم/);
    if (thMatch) {
      out.thickness = Number(thMatch[1]);
    }

    // dims: "L*W" optionally "-SPB"
    // L/W 2-4 digits, SPB 2-3 digits commonly like 025
    const dimMatch = q.match(/(\d{2,4})\s*\*\s*(\d{2,4})(?:-(\d{2,3}))?/);
    if (dimMatch) {
      const L = Number(dimMatch[1]);
      const W = Number(dimMatch[2]);
      const spb = dimMatch[3] ? Number(dimMatch[3]) : undefined;
      out.dims = { length: L, width: W, spb };
      if (spb != null) out.impliedType = 'box';
    }

    // crude tokenization for name-ish words:
    // remove recognized parts (ملم + dims) then split remaining
    let remainder = q;
    remainder = remainder.replace(/(\d+(?:\.\d+)?)\s*ملم/g, ' ');
    remainder = remainder.replace(/(\d{2,4})\s*\*\s*(\d{2,4})(?:-(\d{2,3}))?/g, ' ');
    const tokens = remainder
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    out.nameTokens = tokens;

    // Optional: infer 'sheet' if they literally type "sheet"/"شيت" etc. (not required)
    // if (/\b(sheet|شيت)\b/i.test(q)) out.impliedType = 'sheet';

    return out;
  }

  /** Whether a row matches parsed filters */
  private rowMatchesSearch(row: any, f: ReturnType<typeof this.parseSearchQuery>): boolean {
    // thickness match (allow tiny float tolerance)
    if (typeof f.thickness === 'number') {
      const rowTh = Number(row.thickness);
      if (!(Math.abs(rowTh - f.thickness) < 0.001)) return false;
    }

    // dims match
    if (f.dims) {
      const L = this.toNum(row.length);
      const W = this.toNum(row.width);
      if (!(L === f.dims.length && W === f.dims.width)) return false;

      // SPB only matters for box
      if (typeof f.dims.spb === 'number') {
        if (row.type !== 'box') return false;
        const spb = this.toNum(row.sheetsPerBox);
        if (!(spb === f.dims.spb)) return false;
      }
    }

    // implied type (from -SPB)
    if (f.impliedType) {
      if (row.type !== f.impliedType) return false;
    }

    // name tokens: must all exist in itemName OR descriptionName (case-insensitive)
    if (f.nameTokens.length) {
      const hay = `${row.itemName || ''} ${row.descriptionName || ''} ${row.origin || ''}`
        .toLowerCase();
      for (const t of f.nameTokens) {
        if (!hay.includes(t.toLowerCase())) return false;
      }
    }

    return true;
  }

  /** Build group payload (same shape as your browsing API) */
  private buildGroupPayload(
    key: string,
    items: any[],
    limitPerGroup: number,
    pagePerGroup: number,
  ) {
    const ordered = this.orderLikeItemsService(items);
    const start = (pagePerGroup - 1) * limitPerGroup;
    const slice = ordered.slice(start, start + limitPerGroup);

    return {
      groupKey: key,
      descriptionName: items[0]?.descriptionName || '',
      items: slice,
      total: ordered.length,
      page: pagePerGroup,
      totalPages: Math.ceil(ordered.length / limitPerGroup),
    };
  }

  /** MAIN: Search within the browsing for a customer */
async searchBrowsingInvoices(
  customerId: number,
  q: string,
  limitPerGroup = 5,
  pagePerGroup = 1,
  groupKey?: string, // realDescriptionId as string
) {
  // 1) Load same data but with realDescription (NOT itemNameDescription)
  const invoices = await this.invoiceRepository.find({
    where: { customer: { id: customerId } },
    relations: [
      'items',
      'items.itemBatch',
      'items.itemVariant',
      'items.itemVariant.thickness',
      'items.itemVariant.thickness.item',
      'items.itemVariant.realDescription', // ⬅️ switched
    ],
    order: { date: 'DESC' },
  });

  // 2) Flatten to rows (now keyed by realDescription)
  const allRows = invoices.flatMap((invoice) =>
    (invoice.items || []).map((item) => {
      const variant = item.itemVariant;
      const th = variant?.thickness;
      const it = th?.item;
      const real = (variant as any)?.realDescription;
      const batch = item.itemBatch;

      const type = it?.type || '';

      const length =
        (variant as any)?.length ??
        (variant as any)?.dimensions?.length ??
        null;

      const width =
        (variant as any)?.width ??
        (variant as any)?.dimensions?.width ??
        null;

      // human label from real description
      const descriptionName = real
        ? [real.categoryName, real.subCategory, real.colorName, real.designName]
            .filter(Boolean)
            .join(' | ')
        : '(No Description)';

      return {
        // GROUPING identity (REAL)
        realDescriptionId: real?.id || 0,

        // display
        invoiceDate: invoice.date,
        invoiceNumber: invoice.invoiceNumber,
        itemName: it?.itemName || '',
        descriptionName,

        // sort signals
        itemSortIndex: (it as any)?.sortIndex ?? (it as any)?.sort_index ?? null,
        thickness: th?.thickness ?? '',
        thicknessSortIndex: (th as any)?.sort_index ?? (th as any)?.sortIndex ?? null,

        origin: variant?.origin ?? '',
        type,
        length,
        width,
        box: type === 'box' ? item.quantity : 0,
        sheet: type === 'sheet' ? item.quantity : 0,
        sheetsPerBox: type === 'box' ? variant?.sheetsPerBox || 0 : null,

        sqm: item.sqm,
        unitPrice: item.unitPrice,
        vat: item.vat,
        totalAmount: item.totalAmount,

        itemVariantId: variant?.id || 0,
        itemBatchId: batch?.id || 0,
      };
    }),
  );

  // 3) Parse the query and filter (unchanged)
  const parsed = this.parseSearchQuery(q);
  const filtered =
    parsed.nameTokens.length || parsed.thickness != null || parsed.dims != null || parsed.impliedType
      ? allRows.filter((r) => this.rowMatchesSearch(r, parsed))
      : allRows;

  // 4) Group by realDescriptionId
  const grouped = new Map<string, any[]>();
  for (const row of filtered) {
    const key = String(row.realDescriptionId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  // 5) Single-group pagination
  if (groupKey) {
    const items = grouped.get(groupKey) || [];
    return this.buildGroupPayload(groupKey, items, limitPerGroup, pagePerGroup);
  }

  // 6) Build page 1 for each group
  const groups = Array.from(grouped.entries()).map(([key, items]) =>
    this.buildGroupPayload(key, items, limitPerGroup, 1),
  );

  // 7) Order groups by Item order (sortIndex NULLS LAST → name ASC)
  const groupOrderKey = (g: any) => {
    const fallbackGroup = grouped.get(g.groupKey);
    const src = (g.items[0] ?? (fallbackGroup ? fallbackGroup[0] : undefined)) ?? {};
    const sortIdx = this.nullLast(src.itemSortIndex);
    const name = src.itemName || '';
    return { sortIdx, name };
  };

  groups.sort((A, B) => {
    const a = groupOrderKey(A);
    const b = groupOrderKey(B);
    if (a.sortIdx !== b.sortIdx) return a.sortIdx - b.sortIdx;
    return a.name.localeCompare(b.name);
  });

  return groups;
}




async listInvoiceDisplayNames(opts?: { q?: string }) {
  const qb = this.varientRepo
    .createQueryBuilder('v')
    .leftJoinAndSelect('v.thickness', 't')
    .leftJoinAndSelect('t.item', 'i')
    .leftJoin('v.realDescription', 'rd') // join so we can sort by sort_index
    .where('v.realDescriptionId IS NOT NULL'); // ✅ only variants with realDescriptionId

  // search
  if (opts?.q && opts.q.trim()) {
    const q = `%${opts.q.trim()}%`;
    qb.andWhere(
      `(i.itemName LIKE :q OR COALESCE(v.invoiceDisplayName,'') LIKE :q OR COALESCE(v.origin,'') LIKE :q)`,
      { q },
    );
  }

  // ✅ MySQL-safe "NULLS LAST" for sort index
  qb.orderBy('rd.sort_index_real_description IS NULL', 'ASC')
    .addOrderBy('rd.sort_index_real_description', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('i.itemName', 'ASC')
    .addOrderBy('v.origin', 'ASC');

  const variants = await qb.getMany();

  return variants.map((v) => ({
    itemVariantId: v.id,
    origin: (v as any).origin ?? null,
    invoiceDisplayName: (v as any).invoiceDisplayName ?? '',
    thickness: (v as any).thickness?.thickness ?? null,
    itemName: (v as any).thickness?.item?.itemName ?? null,
  }));
}

async listInvoiceDisplayNameDescription(opts?: { q?: string }) {
  const qb = this.varientRepo
    .createQueryBuilder('v')
    .leftJoinAndSelect('v.thickness', 't')
    .leftJoinAndSelect('t.item', 'i')

    // ✅ join ItemNameDescription (adjust relation name if needed)
    .leftJoinAndSelect('v.itemNameDescription', 'd')

    // ✅ only variants that have itemNameDescriptionId
    .where('v.itemNameDescriptionId IS NOT NULL');

  if (opts?.q && opts.q.trim()) {
    const q = `%${opts.q.trim()}%`;
    qb.andWhere(
      `(i.itemName LIKE :q
        OR COALESCE(v.invoiceDisplayName,'') LIKE :q
        OR COALESCE(v.origin,'') LIKE :q
      )`,
      { q },
    );
  }

  // ✅ MySQL "NULLS LAST" emulation:
  //   (d.sort_index_description IS NULL) -> 0 first, 1 last
  qb.orderBy('d.sort_index_description IS NULL', 'ASC')
    .addOrderBy('d.sort_index_description', 'ASC')
    .addOrderBy('t.thickness', 'ASC')
    .addOrderBy('i.itemName', 'ASC')
    .addOrderBy('v.origin', 'ASC');

  const variants = await qb.getMany();

  return variants.map((v) => ({
    itemVariantId: v.id,
    itemNameDescriptionId: (v as any).itemNameDescriptionId ?? null,
    origin: (v as any).origin ?? null,
    invoiceDisplayName: v.invoiceDisplayName ?? '',
    thickness: (v as any).thickness?.thickness ?? null,
    itemName: (v as any).thickness?.item?.itemName ?? null,

    // ✅ for debug / UI
    sort_index_description: (v as any).itemNameDescription?.sort_index_description ?? null,
  }));
}




async updateInvoiceDisplayNames(payload: {
  items: { itemVariantId: number; invoiceDisplayName: string | null }[];
}) {
  if (!payload?.items || !Array.isArray(payload.items)) {
    throw new BadRequestException("Invalid payload: items[] is required");
  }

  const ids = payload.items
    .map((i) => Number(i.itemVariantId))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!ids.length) return { updated: 0 };

  // Load thickness+item so we can build the default name
  const variants = await this.varientRepo.find({
    where: { id: In(ids) },
    relations: ["thickness", "thickness.item"],
  });

  const byId = new Map(variants.map((v) => [v.id, v]));

  const buildDefault = (v: any) => {
    const th = v?.thickness?.thickness;
    const name = v?.thickness?.item?.itemName;
    const thText =
      th !== null && th !== undefined && String(th).trim() !== ""
        ? `${parseFloat(String(th))} ملم `
        : "";
    return `${thText}${name ?? ""}`.trim();
  };

  let updatedCount = 0;
  const toSave: any[] = [];

  for (const item of payload.items) {
    const v = byId.get(Number(item.itemVariantId));
    if (!v) continue;

    const input =
      typeof item.invoiceDisplayName === "string"
        ? item.invoiceDisplayName.trim()
        : "";

    // ✅ If empty => save default = thickness + itemName
    const next = input.length > 0 ? input : buildDefault(v);

    // only save if changed (optional but better)
    const current = (v.invoiceDisplayName ?? "").trim();
    if (current !== next) {
      v.invoiceDisplayName = next; // store the resolved name
      toSave.push(v);
      updatedCount++;
    }
  }

  if (toSave.length) {
    await this.varientRepo.save(toSave);
  }

  return { updated: updatedCount };
}

// invoices.service.ts (or variants service)
async fillMissingInvoiceDisplayNames() {
  const variants = await this.varientRepo.find({
    where: { invoiceDisplayName: IsNull() },
    relations: ["thickness", "thickness.item"],
  });

  const buildDefault = (v: any) => {
    const th = v?.thickness?.thickness;
    const name = v?.thickness?.item?.itemName ?? "";
    const thText =
      th !== null && th !== undefined && String(th).trim() !== ""
        ? `${parseFloat(String(th))} ملم `
        : "";
    return `${thText}${name}`.trim();
  };

  for (const v of variants) {
    v.invoiceDisplayName = buildDefault(v);
  }

  if (variants.length) await this.varientRepo.save(variants);
  return { updated: variants.length };
}




// search invoice api:

// invoices.service.ts (inside InvoiceService)
async searchFilteredInvoices(
  q: string | undefined,
  page: number,
  limit: number,
): Promise<{ data: any[]; total: number; totalPages: number }> {
  const pageNum = Number.isFinite(page) && page > 0 ? page : 1;
  const take = Number.isFinite(limit) && limit > 0 ? limit : 100;
  const skip = (pageNum - 1) * take;

  const qb = this.invoiceRepository
    .createQueryBuilder("inv")
    .leftJoinAndSelect("inv.customer", "customer")
    .orderBy("inv.id", "DESC")
    .skip(skip)
    .take(take);

  const norm = (s?: string) => (s ?? "").trim();

  // Normalize "YYYY/MM/DD" or "YYYY-MM-DD" to "YYYY-MM-DD"; return null if invalid
  const toYMD = (s: string): string | null => {
    if (!s) return null;
    const t = s.replace(/\//g, "-");
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  };

  const QQ = norm(q);

  if (!QQ) {
    const [invoices, total] = await qb.getManyAndCount();
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
      totalPages: Math.ceil(total / take),
    };
  }

  // Date range forms:
  //   "YYYY-MM-DD..YYYY-MM-DD"
  //   "YYYY/MM/DD..YYYY/MM/DD"
  //   also allow "to" or a single "-" between dates
  const range = QQ.match(
    /(\d{4}[-/]\d{2}[-/]\d{2})\s*(?:\.\.|to|-)\s*(\d{4}[-/]\d{2}[-/]\d{2})/i
  );
  const single = QQ.match(/^(\d{4}[-/]\d{2}[-/]\d{2})$/);
  const digitsOnly = /^\d+$/.test(QQ);

  // helper: for each token, it must match ANY of these fields (AND across tokens)
  const applyTokenSearch = (tokens: string[]) => {
    tokens.forEach((tok, i) => {
      const key = `t${i}`;
      const val = `%${tok.toLowerCase()}%`;

      qb.andWhere(
        new Brackets((b) => {
          b.where("LOWER(inv.invoiceNumber) LIKE :inv_" + key, { ["inv_" + key]: val })
            .orWhere("LOWER(customer.customerName) LIKE :cname_" + key, { ["cname_" + key]: val })
            .orWhere("LOWER(customer.firstName) LIKE :fn_" + key, { ["fn_" + key]: val })
            .orWhere("LOWER(customer.middleName) LIKE :mn_" + key, { ["mn_" + key]: val })
            .orWhere("LOWER(customer.lastName) LIKE :ln_" + key, { ["ln_" + key]: val });
        })
      );
    });
  };

  if (range) {
    const d1 = toYMD(range[1]);
    const d2 = toYMD(range[2]);
    if (d1 && d2) qb.andWhere("inv.date BETWEEN :d1 AND :d2", { d1, d2 });
  } else if (single) {
    const d = toYMD(single[1]);
    if (d) qb.andWhere("inv.date = :d", { d });
  } else if (digitsOnly) {
    // Keep your nice tail behavior, BUT also allow matching customer fields
    const seq = QQ.length <= 3 ? QQ.padStart(3, "0") : QQ;

    qb.andWhere(
      new Brackets((b) => {
        b.where("inv.invoiceNumber LIKE :tail", { tail: `%-${seq}` })
          .orWhere("LOWER(inv.invoiceNumber) LIKE :inv", { inv: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.customerName) LIKE :cname", { cname: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.firstName) LIKE :fn", { fn: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.middleName) LIKE :mn", { mn: `%${QQ.toLowerCase()}%` })
          .orWhere("LOWER(customer.lastName) LIKE :ln", { ln: `%${QQ.toLowerCase()}%` });
      })
    );
  } else {
    // General search: split to tokens, AND them, each token can match invoiceNumber OR any name field
    const tokens = QQ.split(/\s+/).filter(Boolean);
    applyTokenSearch(tokens);
  }

  const [invoices, total] = await qb.getManyAndCount();

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
    totalPages: Math.ceil(total / take),
  };
}

async updateInvoice(invoiceId: number, data: any): Promise<Invoice> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  const to2 = (n: number) => Number(Number(n || 0).toFixed(2));
  const num = (v: any) => Number(v || 0);

  // =========================
  // ✅ Batch counter helpers
  // =========================
  const addCounter = (current: any, delta: number) => {
    const next = to2(num(current) + Number(delta || 0));
    return next < 0 ? 0 : next;
  };

  // =========================
  // ✅ StockMode helpers
  // =========================
  type StockMode = "sqm" | "qty" | "none";
  type VariantMeta = { stockMode: string | null; itemType: string | null };

  const parseStockMode = (m: any): StockMode | null => {
    const s = String(m ?? "").trim().toLowerCase();
    if (!s) return null;
    if (s === "none") return "none";
    if (s === "qty" || s === "quantity") return "qty";
    if (s === "sqm") return "sqm";
    if (s === "unit") return "qty";
    return null;
  };

  const resolveStockMode = (opts: {
    itemType?: any;
    payloadMode?: any;
    dbMode?: any;
  }): StockMode => {
    const itemType = String(opts.itemType ?? "").trim().toLowerCase();

    const fromPayload = parseStockMode(opts.payloadMode);
    if (fromPayload === "none") return "none";
    if (itemType === "unit") return "qty";

    const fromDb = parseStockMode(opts.dbMode);
    return fromPayload ?? fromDb ?? "sqm";
  };

  const buildVariantMetaMap = async (variantIds: number[]) => {
    const metaMap = new Map<number, VariantMeta>();

    const ids = (variantIds || [])
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x > 0);

    if (!ids.length) return metaMap;

    const rows = await queryRunner.manager
      .getRepository(ItemVariant)
      .createQueryBuilder("v")
      .leftJoin("v.thickness", "th")
      .leftJoin("th.item", "item")
      .select("v.id", "id")
      .addSelect("item.stockMode", "stockMode")
      .addSelect("item.type", "itemType")
      .where("v.id IN (:...ids)", { ids })
      .getRawMany();

    for (const r of rows) {
      const id = Number((r as any)?.id);
      if (!Number.isFinite(id) || id <= 0) continue;

      metaMap.set(id, {
        stockMode: (r as any)?.stockMode ?? null,
        itemType: (r as any)?.itemType ?? null,
      });
    }
    return metaMap;
  };

  try {
    console.log("🟡 Starting invoice update:", invoiceId);
    console.log("📥 Raw update payload:", data);

    // ✅ ============ CURRENCY LOOKUP START ============
    let currencyId = data.currencyId || 1;
    let currencyCode = "USD";

    if (data.currencyCode) {
      try {
        const Currency = await queryRunner.manager
          .getRepository("Currency")
          .findOne({ where: { currencyCode: data.currencyCode } });

        if (Currency) {
          currencyId = (Currency as any).id;
          currencyCode = String((Currency as any).currencyCode || "USD")
            .trim()
            .toUpperCase();
          console.log(`💱 Currency: ${currencyCode} -> ID ${currencyId}`);
        } else {
          console.warn(`⚠️ Currency '${data.currencyCode}' not found, using USD`);
        }
      } catch (err) {
        console.error("❌ Currency lookup error:", err);
      }
    }
    // ✅ ============ CURRENCY LOOKUP END ============

    const invoiceRepo = queryRunner.manager.getRepository(Invoice);
    const invoiceItemRepo = queryRunner.manager.getRepository(InvoiceItem);
    const invTxRepo = queryRunner.manager.getRepository(InventoryTransaction);
    const batchRepo = queryRunner.manager.getRepository(ItemBatch);
    const variantRepo = queryRunner.manager.getRepository(ItemVariant);
    const sqmPieceRepo = queryRunner.manager.getRepository(SqmPiece);
    const jvRepo = queryRunner.manager.getRepository(JournalVoucher);
    const jvDetailRepo = queryRunner.manager.getRepository(JournalVoucherDetail);

    const existingInvoice = await invoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ["items"],
    });

    if (!existingInvoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    console.log("📄 Existing invoice header:", {
      id: existingInvoice.id,
      invoiceNumber: existingInvoice.invoiceNumber,
      invoiceType: existingInvoice.invoiceType,
      date: existingInvoice.date,
    });

    const oldInvoiceType = existingInvoice.invoiceType as "S" | "G" | "RVR";
    const docNbr = existingInvoice.invoiceNumber;

    const existingItems = await invoiceItemRepo.find({
      where: { invoiceId },
      relations: ["itemBatch", "itemBatch.itemVariant"],
    });

    console.log("📦 Existing invoice items from DB:", existingItems);

    const affectedVariantIds = new Set<number>();

    const oldVariantIds = Array.from(
      new Set(
        (existingItems || [])
          .map((it: any) => Number(it.itemVariantId))
          .filter((x) => Number.isInteger(x) && x > 0),
      ),
    );
    const metaMapOld = await buildVariantMetaMap(oldVariantIds);

    /* -----------------------------------------------------------
       1) UNAPPLY OLD INVOICE EFFECTS
       ----------------------------------------------------------- */
    for (const oldItem of existingItems) {
      const oldVId = Number((oldItem as any).itemVariantId);
      const metaOld = metaMapOld.get(oldVId);
      const oldItemType = metaOld?.itemType ?? null;

      const oldMode = resolveStockMode({
        itemType: oldItemType,
        payloadMode: null,
        dbMode: metaOld?.stockMode,
      });

      if (oldMode === "none") {
        console.log("↩️ Skipping unapply for old item (stockMode=NONE):", (oldItem as any).id);
        continue;
      }

      const qtySqm = Number((oldItem as any).sqm) || 0;

      if ((oldItem as any).sqmPieceId) {
        const piece = await sqmPieceRepo.findOne({
          where: { id: (oldItem as any).sqmPieceId },
        });
        if (piece) {
          const remainingBefore = num((piece as any).sqmRemaining);
          const soldBefore = num((piece as any).sqmSold);

          const newRemaining = Number((remainingBefore + qtySqm).toFixed(4));
          const newSold = Number((soldBefore - qtySqm).toFixed(4));

          (piece as any).sqmRemaining = newRemaining;
          (piece as any).sqmSold = newSold;
          if (newRemaining > 0) (piece as any).isActive = true;

          await sqmPieceRepo.save(piece);
        }
      }

      const batch =
        (oldItem as any).itemBatch ||
        (await batchRepo.findOne({
          where: { id: (oldItem as any).itemBatchId },
          relations: ["itemVariant"],
        }));
      if (!batch) {
        throw new NotFoundException(
          `ItemBatch ${(oldItem as any).itemBatchId} not found while unapplying`,
        );
      }

      const variantId = (batch as any).itemVariant?.id ?? (oldItem as any).itemVariantId;
      if (variantId) affectedVariantIds.add(variantId);

      const moveVal =
        oldMode === "qty"
          ? Number((oldItem as any).quantity) || 0
          : Number((oldItem as any).sqm) || 0;

      (batch as any).start = num((batch as any).start);
      (batch as any).in = num((batch as any).in);
      (batch as any).out = num((batch as any).out);
      (batch as any).startOFR = num((batch as any).startOFR);
      (batch as any).inOFR = num((batch as any).inOFR);
      (batch as any).outOFR = num((batch as any).outOFR);

      if (oldInvoiceType === "S") {
        (batch as any).out = addCounter((batch as any).out, -moveVal);
        (batch as any).outOFR = addCounter((batch as any).outOFR, -moveVal);
      } else if (oldInvoiceType === "G") {
        (batch as any).outOFR = addCounter((batch as any).outOFR, -moveVal);
      } else if (oldInvoiceType === "RVR") {
        (batch as any).in = addCounter((batch as any).in, -moveVal);
      }

      const start = num((batch as any).start);
      const inStd = num((batch as any).in);
      const outStd = num((batch as any).out);
      const startO = num((batch as any).startOFR);
      const inO = num((batch as any).inOFR);
      const outO = num((batch as any).outOFR);

      (batch as any).balance = to2(start + inStd - outStd);
      (batch as any).balanceOFR = to2(startO + inO - outO);

      const chk: (keyof ItemBatch)[] = ["in", "out", "balance", "inOFR", "outOFR", "balanceOFR"];
      for (const key of chk) {
        const val = Number((batch as any)[key]);
        if (!Number.isFinite(val)) {
          throw new BadRequestException(
            `Cannot save NaN in ItemBatch.${String(key)} (batchId=${(batch as any).id})`,
          );
        }
      }

      await batchRepo.save(batch);
    }

    const oldItemIds = existingItems.map((i: any) => i.id);
    if (oldItemIds.length > 0) {
      await invTxRepo.delete({ invoiceItemId: In(oldItemIds) } as any);
      console.log("🗑️ Deleted old inventory transactions for items:", oldItemIds);
    }

    if (existingItems.length > 0) {
      await invoiceItemRepo.remove(existingItems);
      console.log("🗑️ Deleted old invoice items IDs:", oldItemIds);
    }

    /* -----------------------------------------------------------
       2) UPDATE INVOICE HEADER
       ----------------------------------------------------------- */
    (existingInvoice as any).customerId = data.customerId;
    (existingInvoice as any).date = data.date;
    (existingInvoice as any).invoiceType = data.invoiceType;
    (existingInvoice as any).documentNumber = data.documentNumber;
    (existingInvoice as any).branchId = data.branchId;
    (existingInvoice as any).currencyId = currencyId;
    (existingInvoice as any).totalWithoutVAT = data.totalWithoutVAT;
    (existingInvoice as any).totalVAT = data.totalVAT;
    (existingInvoice as any).grandTotal = data.grandTotal;

    // ✅ Ensure a valid rate is saved on the invoice itself
    const nextRate = Number(data.currencyRate ?? 0);
    if (!Number.isFinite(nextRate) || nextRate <= 0) {
      // If you want: allow USD to default to 1
      // if (currencyCode === "USD") (existingInvoice as any).currencyRate = 1;
      // else throw ...
      throw new BadRequestException(`Invalid currencyRate: ${data.currencyRate}`);
    }
    (existingInvoice as any).currencyRate = nextRate;

    (existingInvoice as any).vatPercentage = data.vatPercentage;

    const savedInvoice = await invoiceRepo.save(existingInvoice);
    console.log("✅ Invoice header updated, ID:", (savedInvoice as any).id);

    const isReturn = (savedInvoice as any).invoiceType === "RVR";
    const isG = (savedInvoice as any).invoiceType === "G";

    /* -----------------------------------------------------------
       3) CREATE NEW ITEMS
       ----------------------------------------------------------- */
    const incomingItems = (data.items || []).map((item: any, index: number) => {
      if (item.itemVariantId === undefined || item.itemBatchId === undefined) {
        throw new BadRequestException(`Missing required fields in item[${index}]`);
      }

      const isUnit = String(item.itemType ?? "").trim().toLowerCase() === "unit";
      const qtyForSave = isUnit ? item.sheet ?? item.quantity : item.quantity;
      const sqmForSave = isUnit ? 0 : item.sqm;

      if (sqmForSave === undefined || qtyForSave === undefined) {
        throw new BadRequestException(`Missing required fields in item[${index}]`);
      }

      return invoiceItemRepo.create({
        invoiceId: (savedInvoice as any).id,
        itemVariantId: item.itemVariantId,
        itemBatchId: item.itemBatchId,
        length: item.length ?? null,
        width: item.width ?? null,
        sheetsPerBox: item.sheetsPerBox ?? null,
        sqm: Number(sqmForSave),
        unitPrice: item.unitPrice,
        totalAmount: item.totalAmount,
        vat: item.vat,
        quantity: Number(qtyForSave),
        sqmPieceId:
          item.sqmPieceId != null
            ? Number(item.sqmPieceId)
            : item.sqmPiece && typeof item.sqmPiece.id === "number"
            ? Number(item.sqmPiece.id)
            : null,
      } as any);
    });

    const savedItems = await invoiceItemRepo.save(incomingItems as any);
    console.log("✅ New invoice items saved:", (savedItems as any[]).map((i) => (i as any).id));

    const variantIds: number[] = Array.from(
      new Set(
        (savedItems as any[])
          .map((it) => Number((it as any).itemVariantId))
          .filter((x) => Number.isInteger(x) && x > 0),
      ),
    );

    /* -----------------------------------------------------------
       4) APPLY SQM PIECES FOR NEW ITEMS
       ----------------------------------------------------------- */
    if (Array.isArray(data.items) && data.items.length > 0) {
      for (let index = 0; index < data.items.length; index++) {
        const src = data.items[index];

        const sqmPieceId: number | undefined =
          src.sqmPieceId ??
          (src.sqmPiece && typeof src.sqmPiece.id === "number" ? src.sqmPiece.id : undefined);

        if (!sqmPieceId) continue;

        const lineSqm = Number(src.sqm);
        if (!Number.isFinite(lineSqm) || lineSqm <= 0) continue;

        const piece = await sqmPieceRepo.findOne({ where: { id: sqmPieceId } });
        if (!piece) {
          throw new BadRequestException(`SQM piece ${sqmPieceId} not found for item[${index}].`);
        }

        const remainingBefore = num((piece as any).sqmRemaining);
        const soldBefore = num((piece as any).sqmSold);

        if (lineSqm > remainingBefore + 0.0001) {
          throw new BadRequestException(
            `Item[${index + 1}] sqm (${lineSqm.toFixed(4)}) exceeds remaining sqm (${remainingBefore.toFixed(
              4,
            )}) for SQM piece #${sqmPieceId}.`,
          );
        }

        const newRemainingRaw = remainingBefore - lineSqm;
        const newRemaining = newRemainingRaw <= 0.0001 ? 0 : Number(newRemainingRaw.toFixed(4));
        const newSold = Number((soldBefore + lineSqm).toFixed(4));

        (piece as any).sqmRemaining = newRemaining;
        (piece as any).sqmSold = newSold;
        if (newRemaining === 0) (piece as any).isActive = false;

        await sqmPieceRepo.save(piece);
      }
    }

    /* -----------------------------------------------------------
       5) FILL AVG COST SNAPSHOT
       ----------------------------------------------------------- */
    await this.fillSalesInvoiceAvgCostsFromLastEvent(
      queryRunner,
      new Date((savedInvoice as any).date),
      savedItems as any,
    );

    const metaMapNew = await buildVariantMetaMap(variantIds);

    /* -----------------------------------------------------------
       6) NEW INVENTORY TRANSACTIONS
       ----------------------------------------------------------- */
    const newInventoryTransactions = (savedItems as any[]).flatMap((item, idx) => {
      const src = (data.items || [])[idx] || {};
      const vId = Number(item.itemVariantId);
      const meta = metaMapNew.get(vId);

      const itemType = String(src.itemType ?? meta?.itemType ?? "").trim().toLowerCase();
      const mode = resolveStockMode({
        itemType,
        payloadMode: src.stockMode,
        dbMode: meta?.stockMode,
      });

      if (mode === "none") return [];

      let quantity = 0;
      let sqm = 0;
      let quantityofr = 0;
      let sqmofr = 0;

      const qtyLine = Number(item.quantity) || 0;
      const sqmLine = Number(item.sqm) || 0;

      if (mode === "qty") {
        if ((savedInvoice as any).invoiceType === "RVR") quantity = -qtyLine;
        else if ((savedInvoice as any).invoiceType === "G") quantityofr = -qtyLine;
        else if ((savedInvoice as any).invoiceType === "S") {
          quantity = -qtyLine;
          quantityofr = -qtyLine;
        }
      } else {
        if ((savedInvoice as any).invoiceType === "RVR") {
          quantity = -qtyLine;
          sqm = -sqmLine;
        } else if ((savedInvoice as any).invoiceType === "G") {
          quantityofr = -qtyLine;
          sqmofr = -sqmLine;
        } else if ((savedInvoice as any).invoiceType === "S") {
          quantity = -qtyLine;
          sqm = -sqmLine;
          quantityofr = -qtyLine;
          sqmofr = -sqmLine;
        }
      }

      if (quantity === 0 && sqm === 0 && quantityofr === 0 && sqmofr === 0) return [];

      return [
        invTxRepo.create({
          transactionType: "Sales",
          itemVariantId: item.itemVariantId,
          itemBatchId: item.itemBatchId,
          invoiceItemId: item.id,
          quantity,
          sqm,
          quantityofr,
          sqmofr,
          transactionDate: new Date(),
          dateForEachInvoice: new Date((savedInvoice as any).date),
        } as any),
      ];
    });

    if (newInventoryTransactions.length) {
      await invTxRepo.save(newInventoryTransactions as any);
    }

    /* -----------------------------------------------------------
       7) APPLY NEW BATCH MOVEMENTS
       ----------------------------------------------------------- */
    for (let idx = 0; idx < (savedItems as any[]).length; idx++) {
      const item: any = (savedItems as any[])[idx];
      const src = (data.items || [])[idx] || {};
      const vId = Number(item.itemVariantId);
      const meta = metaMapNew.get(vId);

      const batch = await batchRepo.findOne({
        where: { id: item.itemBatchId },
        relations: ["itemVariant"],
      });
      if (!batch) throw new NotFoundException(`ItemBatch ${item.itemBatchId} not found while applying`);

      const variantId = (batch as any).itemVariant?.id ?? item.itemVariantId;
      if (variantId) affectedVariantIds.add(variantId);

      const itemType = String(src.itemType ?? meta?.itemType ?? "").trim().toLowerCase();
      const mode = resolveStockMode({
        itemType,
        payloadMode: src.stockMode,
        dbMode: meta?.stockMode,
      });
      if (mode === "none") continue;

      const moveVal = mode === "qty" ? Number(item.quantity) || 0 : Number(item.sqm) || 0;

      (batch as any).start = num((batch as any).start);
      (batch as any).in = num((batch as any).in);
      (batch as any).out = num((batch as any).out);
      (batch as any).startOFR = num((batch as any).startOFR);
      (batch as any).inOFR = num((batch as any).inOFR);
      (batch as any).outOFR = num((batch as any).outOFR);

      if ((savedInvoice as any).invoiceType === "S") {
        (batch as any).out = addCounter((batch as any).out, +moveVal);
        (batch as any).outOFR = addCounter((batch as any).outOFR, +moveVal);
      } else if ((savedInvoice as any).invoiceType === "G") {
        (batch as any).outOFR = addCounter((batch as any).outOFR, +moveVal);
      } else if ((savedInvoice as any).invoiceType === "RVR") {
        (batch as any).in = addCounter((batch as any).in, +moveVal);
      }

      const start = num((batch as any).start);
      const inStd = num((batch as any).in);
      const outStd = num((batch as any).out);
      const startO = num((batch as any).startOFR);
      const inO = num((batch as any).inOFR);
      const outO = num((batch as any).outOFR);

      (batch as any).balance = to2(start + inStd - outStd);
      (batch as any).balanceOFR = to2(startO + inO - outO);

      const chk2: (keyof ItemBatch)[] = ["in", "out", "balance", "inOFR", "outOFR", "balanceOFR"];
      for (const key of chk2) {
        const val = Number((batch as any)[key]);
        if (!Number.isFinite(val)) {
          throw new BadRequestException(
            `Cannot save NaN in ItemBatch.${String(key)} (batchId=${(batch as any).id})`,
          );
        }
      }

      await batchRepo.save(batch);
    }

    // Recompute variant totals
    for (const variantId of affectedVariantIds) {
      const variant = await variantRepo.findOne({
        where: { id: variantId },
        relations: ["batches"],
      });
      if (!variant) continue;

      let totalStart = 0;
      let totalIn = 0;
      let totalOut = 0;
      let totalStartOFR = 0;
      let totalInOFR = 0;
      let totalOutOFR = 0;

      for (const b of (variant as any).batches ?? []) {
        totalStart += num((b as any).start);
        totalIn += num((b as any).in);
        totalOut += num((b as any).out);
        totalStartOFR += num((b as any).startOFR);
        totalInOFR += num((b as any).inOFR);
        totalOutOFR += num((b as any).outOFR);
      }

      (variant as any).totalStart = to2(totalStart);
      (variant as any).totalIn = to2(totalIn);
      (variant as any).totalOut = to2(totalOut);
      (variant as any).totalBalance = to2(totalStart + totalIn - totalOut);

      (variant as any).totalStartOFR = to2(totalStartOFR);
      (variant as any).totalInOFR = to2(totalInOFR);
      (variant as any).totalOutOFR = to2(totalOutOFR);
      (variant as any).totalBalanceOFR = to2(totalStartOFR + totalInOFR - totalOutOFR);

      await variantRepo.save(variant);
    }

    /* -----------------------------------------------------------
       8) UPDATE JOURNAL VOUCHER (✅ FIXED like createInvoice)
       ----------------------------------------------------------- */
    const useVAT = Number((savedInvoice as any).vatPercentage) > 0;
    const rate = Number((savedInvoice as any).currencyRate);

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException(`Invalid saved invoice currencyRate: ${(savedInvoice as any).currencyRate}`);
    }

    // ✅ Save the exchange rate on each JV detail row
    const addRateFields = () => ({
      exRateUSD: rate,
      exRateEUROToUSD: 0,
    });

    // Assumption: rate = LL per 1 USD
    const toUsdLl = (amountInInvoiceCurrency: number) => {
      const a = Number(amountInInvoiceCurrency) || 0;
      if (currencyCode === "USD") return { usd: a, ll: a * rate };
      if (currencyCode === "LL") return { usd: a / rate, ll: a };
      return { usd: a, ll: a * rate };
    };

    const salesRole = currencyCode === "USD" ? "Sales_USD" : "Sales_LL";
    const vatRole = currencyCode === "USD" ? "Vat_USD" : "Vat_LL";

    const salesAccount = await this.accountingResolver.resolveAccount(salesRole, null);
    const vatAccount = useVAT ? await this.accountingResolver.resolveAccount(vatRole, null) : null;

    const total = Number((savedInvoice as any).grandTotal) || 0;
    const totalWithoutVAT = Number((savedInvoice as any).totalWithoutVAT) || 0;
    const totalVAT = Number((savedInvoice as any).totalVAT) || 0;
    const salesCrAmount = isG ? totalWithoutVAT + totalVAT : totalWithoutVAT;

    const getJVFields = (type: "dr" | "cr", amount: number): Partial<JournalVoucherDetail> => {
      const { usd, ll } = toUsdLl(amount);

      const fields: any = {
        dr: 0,
        drUSD: 0,
        drLL: 0,
        drOFR: 0,
        drUSDOFR: 0,
        drLLOFR: 0,
        cr: 0,
        crUSD: 0,
        crLL: 0,
        crOFR: 0,
        crUSDOFR: 0,
        crLLOFR: 0,
      };

      if (type === "dr") {
        if (isG) {
          fields.drOFR = amount;
          fields.drUSDOFR = usd;
          fields.drLLOFR = ll;
        } else if (isReturn) {
          fields.dr = amount;
          fields.drUSD = usd;
          fields.drLL = ll;
        } else {
          fields.dr = amount;
          fields.drUSD = usd;
          fields.drLL = ll;
          fields.drOFR = amount;
          fields.drUSDOFR = usd;
          fields.drLLOFR = ll;
        }
      } else {
        if (isG) {
          fields.crOFR = amount;
          fields.crUSDOFR = usd;
          fields.crLLOFR = ll;
        } else if (isReturn) {
          fields.cr = amount;
          fields.crUSD = usd;
          fields.crLL = ll;
        } else {
          fields.cr = amount;
          fields.crUSD = usd;
          fields.crLL = ll;
          fields.crOFR = amount;
          fields.crUSDOFR = usd;
          fields.crLLOFR = ll;
        }
      }

      return fields;
    };

const jvDetailsForInvoice: JournalVoucherDetail[] = [];

// DR: customer
const d1 = jvDetailRepo.create({
  customerId: (savedInvoice as any).customerId,
  description: "فاتورة",
  currency: currencyCode,
  docNbr,
  ...addRateFields(),
  ...getJVFields("dr", total),
} as DeepPartial<JournalVoucherDetail>);
jvDetailsForInvoice.push(d1);

// CR: sales
const d2 = jvDetailRepo.create({
  accountId: (salesAccount as any).id,
  description: "مبيعات خاضعة للضريبة على القيمة المضافة",
  currency: currencyCode,
  docNbr,
  ...addRateFields(),
  ...getJVFields("cr", salesCrAmount),
} as DeepPartial<JournalVoucherDetail>);
jvDetailsForInvoice.push(d2);

// CR: VAT
if (useVAT && vatAccount && !isG) {
  const d3 = jvDetailRepo.create({
    accountId: (vatAccount as any).id,
    description: "ضريبة القيمة المضافة - مبيع VAT",
    currency: currencyCode,
    docNbr,
    ...addRateFields(),
    ...getJVFields("cr", totalVAT),
  } as DeepPartial<JournalVoucherDetail>);
  jvDetailsForInvoice.push(d3);
}

    const sumFrom = (arr: JournalVoucherDetail[], field: keyof JournalVoucherDetail) =>
      arr.reduce((acc, row) => acc + Number((row as any)[field] || 0), 0);

    // Find existing JV details by docNbr (your current strategy)
    const existingDetailsForDoc = await jvDetailRepo.find({ where: { docNbr } } as any);

    if (existingDetailsForDoc.length > 0) {
      const jvId = (existingDetailsForDoc[0] as any).journalVoucherId;
      console.log("🔁 Reusing existing JV id:", jvId);

      // remove old details then insert new ones
      await jvDetailRepo.remove(existingDetailsForDoc as any);

      for (const d of jvDetailsForInvoice) (d as any).journalVoucherId = jvId;
      await jvDetailRepo.save(jvDetailsForInvoice as any);

      const allDetails = await jvDetailRepo.find({ where: { journalVoucherId: jvId } } as any);
      const jvHeader = await jvRepo.findOne({ where: { id: jvId } } as any);

      if (jvHeader) {
        (jvHeader as any).date = (savedInvoice as any).date as any;

        (jvHeader as any).totalDr = sumFrom(allDetails as any, "dr");
        (jvHeader as any).totalDrUSD = sumFrom(allDetails as any, "drUSD");
        (jvHeader as any).totalDrLL = sumFrom(allDetails as any, "drLL");
        (jvHeader as any).totalDrOFR = sumFrom(allDetails as any, "drOFR");
        (jvHeader as any).totalDrUSDOFR = sumFrom(allDetails as any, "drUSDOFR");
        (jvHeader as any).totalDrLLOFR = sumFrom(allDetails as any, "drLLOFR");

        (jvHeader as any).totalCr = sumFrom(allDetails as any, "cr");
        (jvHeader as any).totalCrUSD = sumFrom(allDetails as any, "crUSD");
        (jvHeader as any).totalCrLL = sumFrom(allDetails as any, "crLL");
        (jvHeader as any).totalCrOFR = sumFrom(allDetails as any, "crOFR");
        (jvHeader as any).totalCrUSDOFR = sumFrom(allDetails as any, "crUSDOFR");
        (jvHeader as any).totalCrLLOFR = sumFrom(allDetails as any, "crLLOFR");

        await jvRepo.save(jvHeader as any);
        console.log("✅ Journal voucher updated:", (jvHeader as any).jvNumber);
      }
    } else {
      // create new JV if not found
      const setting2 = await this.settingsRepo.findOneBy({ isActive: true });
      if (!setting2) throw new NotFoundException("Active year not found");

      const yearSuffix2 = String((setting2 as any).year).slice(-2);
      const jvPrefix2 = isG ? "JVG" : "JV";

      const lastJV = await jvRepo
        .createQueryBuilder("jv")
        .where("jv.jvNumber LIKE :prefix", { prefix: `${jvPrefix2}${yearSuffix2}-%` })
        .orderBy("jv.id", "DESC")
        .getOne();

      const jvSequence = (lastJV as any)?.jvNumber
        ? parseInt(String((lastJV as any).jvNumber).split("-")[1], 10) + 1
        : 1;

      const jvNumber = `${jvPrefix2}${yearSuffix2}-${String(jvSequence).padStart(3, "0")}`;

      const journalVoucher = jvRepo.create({
        jvNumber,
        jvType: (savedInvoice as any).invoiceType,
        date: (savedInvoice as any).date,
        totalDr: sumFrom(jvDetailsForInvoice, "dr"),
        totalDrUSD: sumFrom(jvDetailsForInvoice, "drUSD"),
        totalDrLL: sumFrom(jvDetailsForInvoice, "drLL"),
        totalDrOFR: sumFrom(jvDetailsForInvoice, "drOFR"),
        totalDrUSDOFR: sumFrom(jvDetailsForInvoice, "drUSDOFR"),
        totalDrLLOFR: sumFrom(jvDetailsForInvoice, "drLLOFR"),
        totalCr: sumFrom(jvDetailsForInvoice, "cr"),
        totalCrUSD: sumFrom(jvDetailsForInvoice, "crUSD"),
        totalCrLL: sumFrom(jvDetailsForInvoice, "crLL"),
        totalCrOFR: sumFrom(jvDetailsForInvoice, "crOFR"),
        totalCrUSDOFR: sumFrom(jvDetailsForInvoice, "crUSDOFR"),
        totalCrLLOFR: sumFrom(jvDetailsForInvoice, "crLLOFR"),
        details: jvDetailsForInvoice,
      } as any);

      await queryRunner.manager.save(JournalVoucher, journalVoucher as any);
      console.log("✅ Journal voucher created:", jvNumber);
    }

    await queryRunner.commitTransaction();

    const forList = await this.invoiceRepository.findOne({
      where: { id: (savedInvoice as any).id },
      relations: ["customer"],
    });

    this.invoiceGateway.emitInvoiceUpdated({
      id: (forList as any)?.id ?? (savedInvoice as any).id,
      invoiceNumber: (forList as any)?.invoiceNumber ?? (savedInvoice as any).invoiceNumber,
      date: (forList as any)?.date ?? (savedInvoice as any).date,
      grandTotal: (forList as any)?.grandTotal ?? (savedInvoice as any).grandTotal,
      customerName:
        (forList as any)?.customer?.customerName ??
        (forList as any)?.customerName ??
        "Unknown",
    });

    console.log("🎉 Invoice update complete for id:", (savedInvoice as any).id);
    return savedInvoice;
  } catch (error: any) {
    console.error("❌ Invoice update failed:", error?.message, error);
    await queryRunner.rollbackTransaction();
    throw new BadRequestException(error.message || "Invoice update failed");
  } finally {
    await queryRunner.release();
  }
}





async createReturnInvoice(
  originalInvoiceId: number,
  body: {
    date?: string;
    note?: string;
    items: Array<{
      // Recommended (solves ambiguity if same batch appears multiple times):
      sourceInvoiceItemId?: number;

      // What you said you will send:
      itemBatchId: number;

      // Optional but helps matching:
      itemVariantId?: number;
      sqmPieceId?: number | null;
      length?: number | null;
      width?: number | null;

      // Partial quantities:
      quantity?: number; // for unit/qty mode OR if you want ratio-based sqm calc
      sqm?: number; // for sqm mode OR exact sqm return

      // Optional per-line note if you have a column for it (ignore if not)
      note?: string;
    }>;
  },
): Promise<Invoice> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  // ---- helpers
  const EPS = 0.0001;
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const normalizeStockMode = (m: any) => {
    const s = String(m ?? "").trim().toLowerCase();
    if (s === "unit") return "qty";
    if (s === "none") return "none";
    return s || "sqm";
  };

  const keyOf = (x: {
    itemVariantId?: any;
    itemBatchId?: any;
    sqmPieceId?: any;
    length?: any;
    width?: any;
  }) => {
    const vId = n(x.itemVariantId);
    const bId = n(x.itemBatchId);
    const pId = n(x.sqmPieceId) || 0;
    const L = x.length == null ? "" : String(x.length);
    const W = x.width == null ? "" : String(x.width);
    return `${vId}|${bId}|${pId}|${L}|${W}`;
  };

  try {
    const setting = await this.settingsRepo.findOneBy({ isActive: true });
    if (!setting) throw new NotFoundException("Active year not found");
    const yearSuffix = String(setting.year || "").slice(-2);

    // 1) Load original invoice + items
    const original = await queryRunner.manager.getRepository(Invoice).findOne({
      where: { id: originalInvoiceId },
      relations: ["customer", "items"],
    });
    if (!original) throw new NotFoundException(`Invoice ${originalInvoiceId} not found`);

    if (original.invoiceType === "RTN") {
      throw new BadRequestException("Cannot create a return from a RTN invoice.");
    }

    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw new BadRequestException("RTN items[] is required for partial return.");
    }

    const baseType = original.invoiceType as "S" | "G" | "RVR";
    const baseIsG = baseType === "G";
    const baseIsRvr = baseType === "RVR";

    // ✅ REMOVE: duplicate RTN prevention (partial allows multiple RTNs)
    // const existing = ...

    // 2) Numbering rules (same as you had)
    const rtnPrefix = baseIsG ? `RG${yearSuffix}-` : `R${yearSuffix}-`;

    const lastRTN = await queryRunner.manager
      .getRepository(Invoice)
      .createQueryBuilder("inv")
      .where("inv.invoiceType = :t", { t: "RTN" })
      .andWhere("inv.invoiceNumber LIKE :prefix", { prefix: `${rtnPrefix}%` })
      .orderBy("inv.id", "DESC")
      .getOne();

    let seq = 1;
    if (lastRTN?.invoiceNumber) {
      const parts = lastRTN.invoiceNumber.split("-");
      seq = (parseInt(parts[1], 10) || 0) + 1;
    }
    const rtnNumber = `${rtnPrefix}${String(seq).padStart(3, "0")}`;

    // 3) Load previous RTNs for this original to validate remaining
    const prevRTNs = await queryRunner.manager.getRepository(Invoice).find({
      where: { invoiceType: "RTN" as any, returnOfInvoiceId: original.id as any } as any,
      relations: ["items"],
    });

    // Build "returned so far" map (by key)
    const returnedQtyByKey = new Map<string, number>();
    const returnedSqmByKey = new Map<string, number>();

    for (const r of prevRTNs) {
      for (const it of r.items || []) {
        const k = keyOf(it as any);
        returnedQtyByKey.set(k, (returnedQtyByKey.get(k) || 0) + n((it as any).quantity));
        returnedSqmByKey.set(k, (returnedSqmByKey.get(k) || 0) + n((it as any).sqm));
      }
    }

    // 4) stockMode map (same idea you had)
    const invItems = original.items || [];
    const variantIds = Array.from(
      new Set(invItems.map((x) => n((x as any).itemVariantId)).filter((id) => id > 0)),
    );

    const stockModeMap = new Map<number, string>();
    if (variantIds.length) {
      const rows = await queryRunner.manager
        .getRepository(ItemVariant)
        .createQueryBuilder("v")
        .leftJoin("v.thickness", "th")
        .leftJoin("th.item", "item")
        .select("v.id", "id")
        .addSelect("item.stockMode", "stockMode")
        .where("v.id IN (:...ids)", { ids: variantIds })
        .getRawMany();

      for (const r of rows) {
        const id = n((r as any)?.id);
        const mode = normalizeStockMode((r as any)?.stockMode);
        if (id > 0) stockModeMap.set(id, mode);
      }
    }

    // 5) Resolve each requested line to a source original invoice item + validate remaining
    const invItemRepo = queryRunner.manager.getRepository(InvoiceItem);

    // index original by id
    const origById = new Map<number, any>();
    for (const it of invItems) origById.set(n((it as any).id), it);

    // index original by key (might be ambiguous)
    const origByKey = new Map<string, any[]>();
    for (const it of invItems) {
      const k = keyOf(it as any);
      const arr = origByKey.get(k) || [];
      arr.push(it);
      origByKey.set(k, arr);
    }

    const createdItems: InvoiceItem[] = [];

    // We'll compute totals from created lines
    let totalWithoutVAT = 0;
    let totalVAT = 0;

    const vatPct = n((original as any).vatPercentage);
    const hasVAT = vatPct > 0;

    for (const req of body.items) {
      const reqBatchId = n(req.itemBatchId);
      if (!reqBatchId) throw new BadRequestException("Each RTN line must include itemBatchId.");

      let src: any | undefined;

      // best: sourceInvoiceItemId
      if (req.sourceInvoiceItemId) {
        src = origById.get(n(req.sourceInvoiceItemId));
        if (!src) {
          throw new BadRequestException(`sourceInvoiceItemId ${req.sourceInvoiceItemId} not found in original invoice.`);
        }
      } else {
        // match by key-ish (using what the user sends + fallback to original)
        const probe = {
          itemVariantId: req.itemVariantId ?? undefined,
          itemBatchId: reqBatchId,
          sqmPieceId: req.sqmPieceId ?? undefined,
          length: req.length ?? undefined,
          width: req.width ?? undefined,
        };

        // If user didn't send variantId/length/width, try to infer by searching originals with same batchId
        let candidates = invItems.filter((x: any) => n(x.itemBatchId) === reqBatchId);

        if (req.itemVariantId) candidates = candidates.filter((x: any) => n(x.itemVariantId) === n(req.itemVariantId));
        if (req.sqmPieceId != null) candidates = candidates.filter((x: any) => n(x.sqmPieceId) === n(req.sqmPieceId));
        if (req.length != null) candidates = candidates.filter((x: any) => String(x.length ?? "") === String(req.length));
        if (req.width != null) candidates = candidates.filter((x: any) => String(x.width ?? "") === String(req.width));

        if (candidates.length === 0) {
          throw new BadRequestException(`No matching original item found for batch ${reqBatchId}.`);
        }
        if (candidates.length > 1) {
          throw new BadRequestException(
            `Ambiguous match for batch ${reqBatchId}. Send sourceInvoiceItemId to choose the exact line.`,
          );
        }
        src = candidates[0];
      }

      const vId = n(src.itemVariantId);
      const mode = normalizeStockMode(stockModeMap.get(vId));

      // stockMode NONE => you can allow RTN financially, but must not touch inventory.
      // We'll still allow creating the line, just no inv tx / batch updates later (your existing logic already skips those).
      const srcQty = n(src.quantity);
      const srcSqm = n(src.sqm);

      let qty = n(req.quantity);
      let sqm = n(req.sqm);

      // If sqm not provided, derive sqm ratio from original
      if (sqm <= 0 && qty > 0 && srcQty > 0 && srcSqm > 0) {
        const sqmPerQty = srcSqm / srcQty;
        sqm = Number((qty * sqmPerQty).toFixed(4));
      }

      // If qty not provided, derive qty ratio from original
      if (qty <= 0 && sqm > 0 && srcSqm > 0 && srcQty > 0) {
        const qtyPerSqm = srcQty / srcSqm;
        qty = Number((sqm * qtyPerSqm).toFixed(4));
      }

      if (qty <= 0 && sqm <= 0) {
        throw new BadRequestException(`RTN line must include quantity and/or sqm (batch ${reqBatchId}).`);
      }

      // Remaining validation (by key)
      const srcKey = keyOf(src as any);

      const alreadyQty = returnedQtyByKey.get(srcKey) || 0;
      const alreadySqm = returnedSqmByKey.get(srcKey) || 0;

      const remQty = srcQty - alreadyQty;
      const remSqm = srcSqm - alreadySqm;

      // validate based on mode, but also protect both when available
      if (mode === "qty") {
        if (qty > remQty + EPS) {
          throw new BadRequestException(
            `Return qty exceeds remaining for batch ${reqBatchId}. Remaining qty: ${remQty}`,
          );
        }
        // if original had sqm, also protect it
        if (srcSqm > 0 && sqm > remSqm + EPS) {
          throw new BadRequestException(
            `Return sqm exceeds remaining for batch ${reqBatchId}. Remaining sqm: ${remSqm}`,
          );
        }
      } else {
        if (sqm > remSqm + EPS) {
          throw new BadRequestException(
            `Return sqm exceeds remaining for batch ${reqBatchId}. Remaining sqm: ${remSqm}`,
          );
        }
        // if original had qty, also protect it
        if (srcQty > 0 && qty > remQty + EPS) {
          throw new BadRequestException(
            `Return qty exceeds remaining for batch ${reqBatchId}. Remaining qty: ${remQty}`,
          );
        }
      }

      // price/vat math
      const unitPrice = n(src.unitPrice);
      const baseAmount = mode === "qty" ? unitPrice * qty : unitPrice * sqm;
      const vatAmount = hasVAT ? baseAmount * (vatPct / 100) : 0;

      const baseAmount2 = Number(baseAmount.toFixed(2));
      const vatAmount2 = Number(vatAmount.toFixed(2));

      totalWithoutVAT += baseAmount2;
      totalVAT += vatAmount2;

const item = invItemRepo.create({
  itemVariantId: src.itemVariantId,
  itemBatchId: src.itemBatchId,
  sqmPieceId: src.sqmPieceId ?? null,
  length: src.length ?? null,
  width: src.width ?? null,
  sheetsPerBox: src.sheetsPerBox ?? null,
  sqm: sqm > 0 ? sqm : 0,
  unitPrice,
  totalAmount: baseAmount2,
  vat: vatAmount2,
  quantity: qty > 0 ? qty : 0,

  averageCost: src.averageCost ?? null,
  averageCostC: src.averageCostC ?? null,
  averageCostVM: src.averageCostVM ?? null,
  averageCostCVM: src.averageCostCVM ?? null,
  lastCost: src.lastCost ?? null,
  lastCostC: src.lastCostC ?? null,
  lastCostVM: src.lastCostVM ?? null,
  lastCostCVM: src.lastCostCVM ?? null,
} as DeepPartial<InvoiceItem>);

createdItems.push(item);


      
    }

    const grandTotal = Number((totalWithoutVAT + totalVAT).toFixed(2));

    // 6) Create RTN invoice header (totals from partial lines!)
    const invRepo = queryRunner.manager.getRepository(Invoice);

    const rtn: Invoice = invRepo.create({
      customerId: original.customerId,
      date: body?.date ? new Date(body.date) : new Date(),
      invoiceType: "RTN",
      invoiceNumber: rtnNumber,
      documentNumber: rtnNumber,
      branchId: original.branchId,
      currencyId: original.currencyId,
      totalWithoutVAT: Number(totalWithoutVAT.toFixed(2)),
      totalVAT: Number(totalVAT.toFixed(2)),
      grandTotal,
      currencyRate: original.currencyRate,
      vatPercentage: original.vatPercentage,
      returnOfInvoiceId: original.id,
      // if you have invoice note column:
      // note: body?.note ?? null,
    } as DeepPartial<Invoice>) as Invoice;

    const savedRTN = await invRepo.save(rtn);

    // 7) Save RTN items (partial)
    for (const it of createdItems) (it as any).invoiceId = savedRTN.id;
    const savedRTNItems: InvoiceItem[] = await queryRunner.manager.getRepository(InvoiceItem).save(createdItems);

    // 8) SQM PIECES: add sqm back (reverse sold/remaining) — unchanged (but now partial)
    const sqmPieceRepo = queryRunner.manager.getRepository(SqmPiece);

    for (const it of savedRTNItems) {
      if (!it.sqmPieceId) continue;

      const lineSqm = n((it as any).sqm);
      if (lineSqm <= 0) continue;

      const piece = await sqmPieceRepo.findOne({ where: { id: it.sqmPieceId } });
      if (!piece) throw new BadRequestException(`SQM piece ${it.sqmPieceId} not found.`);

      const remainingBefore = n(piece.sqmRemaining);
      const soldBefore = n(piece.sqmSold);

      const newSoldRaw = soldBefore - lineSqm;
      if (newSoldRaw < -EPS) {
        throw new BadRequestException(`Return sqm exceeds sold sqm for SQM piece #${it.sqmPieceId}.`);
      }

      const newSold = newSoldRaw <= EPS ? 0 : Number(newSoldRaw.toFixed(4));
      const newRemaining = Number((remainingBefore + lineSqm).toFixed(4));

      piece.sqmSold = newSold;
      piece.sqmRemaining = newRemaining;
      if (newRemaining > 0) piece.isActive = true;

      await sqmPieceRepo.save(piece);
    }

    // 9) INVENTORY TRANSACTIONS (only for returned lines) — your logic reused
    const returnedVariantIds = Array.from(
      new Set(
        savedRTNItems
          .map((x) => n((x as any).itemVariantId))
          .filter((id) => id > 0),
      ),
    );

    // stockModeMap already built for originals, but ensure missing ids handled:
    const invTxRepo = queryRunner.manager.getRepository(InventoryTransaction);
    const invTxs: InventoryTransaction[] = [];

    for (const it of savedRTNItems) {
      const vId = n((it as any).itemVariantId);
      const mode = normalizeStockMode(stockModeMap.get(vId));

      // ✅ stockMode NONE -> no inventory transaction
      if (mode === "none") continue;

      const qtyLine = n((it as any).quantity);
      const sqmLine = n((it as any).sqm);

      let quantity = 0,
        sqm = 0,
        quantityofr = 0,
        sqmofr = 0;

      if (mode === "qty") {
        if (baseType === "S") {
          quantity = +qtyLine;
          quantityofr = +qtyLine;
        } else if (baseType === "G") {
          quantityofr = +qtyLine;
        } else if (baseType === "RVR") {
          quantity = +qtyLine;
        }
      } else {
        if (baseType === "S") {
          quantity = +qtyLine;
          sqm = +sqmLine;
          quantityofr = +qtyLine;
          sqmofr = +sqmLine;
        } else if (baseType === "G") {
          quantityofr = +qtyLine;
          sqmofr = +sqmLine;
        } else if (baseType === "RVR") {
          quantity = +qtyLine;
          sqm = +sqmLine;
        }
      }

      if (quantity === 0 && sqm === 0 && quantityofr === 0 && sqmofr === 0) continue;

      invTxs.push(
        invTxRepo.create({
          transactionType: "Sales Return",
          itemVariantId: it.itemVariantId,
          itemBatchId: it.itemBatchId,
          invoiceItemId: it.id,
          quantity,
          sqm,
          quantityofr,
          sqmofr,
          transactionDate: new Date(),
          dateForEachInvoice: new Date(savedRTN.date),
        }),
      );
    }

    if (invTxs.length) await invTxRepo.save(invTxs);

    // 10) UPDATE BATCHES + recompute balances (only for returned lines) — your logic reused
    const batchRepo = queryRunner.manager.getRepository(ItemBatch);
    const affectedVariantIds = new Set<number>();

    for (const it of savedRTNItems) {
      const vId = n((it as any).itemVariantId);
      const mode = normalizeStockMode(stockModeMap.get(vId));

      // ✅ stockMode NONE -> do not touch batches
      if (mode === "none") continue;

      const batch = await batchRepo.findOne({
        where: { id: it.itemBatchId },
        relations: ["itemVariant"],
      });
      if (!batch) throw new NotFoundException(`ItemBatch ${it.itemBatchId} not found`);

      const variantId = n((batch as any).itemVariant?.id ?? (it as any).itemVariantId);
      if (variantId > 0) affectedVariantIds.add(variantId);

      const qtySqm = n((it as any).sqm);

      if (baseType === "S") {
        batch.out = n(batch.out) - qtySqm;
        batch.outOFR = n(batch.outOFR) - qtySqm;
      } else if (baseType === "G") {
        batch.outOFR = n(batch.outOFR) - qtySqm;
      } else if (baseType === "RVR") {
        batch.in = n(batch.in) - qtySqm;
      }

      const keys = ["in", "out", "inOFR", "outOFR"] as const;
      for (const k of keys) {
        if (n((batch as any)[k]) < -EPS) {
          throw new BadRequestException(`Batch ${batch.id} would go negative on ${k} after return.`);
        }
        if (n((batch as any)[k]) < 0) (batch as any)[k] = 0;
      }

      const start = n(batch.start);
      const inStd = n(batch.in);
      const outStd = n(batch.out);
      const startOfr = n(batch.startOFR);
      const inOfr = n(batch.inOFR);
      const outOfr = n(batch.outOFR);

      batch.balance = Number((start + inStd - outStd).toFixed(2));
      batch.balanceOFR = Number((startOfr + inOfr - outOfr).toFixed(2));

      await batchRepo.save(batch);
    }

    // 11) RECOMPUTE VARIANT TOTALS FROM BATCHES — unchanged
    const variantRepo = queryRunner.manager.getRepository(ItemVariant);

    for (const variantId of affectedVariantIds) {
      const variant = await variantRepo.findOne({
        where: { id: variantId },
        relations: ["batches"],
      });
      if (!variant) continue;

      let totalStart = 0,
        totalIn = 0,
        totalOut = 0,
        totalStartOFR = 0,
        totalInOFR = 0,
        totalOutOFR = 0;

      for (const b of (variant as any).batches ?? []) {
        totalStart += n((b as any).start);
        totalIn += n((b as any).in);
        totalOut += n((b as any).out);
        totalStartOFR += n((b as any).startOFR);
        totalInOFR += n((b as any).inOFR);
        totalOutOFR += n((b as any).outOFR);
      }

      (variant as any).totalStart = Number(totalStart.toFixed(2));
      (variant as any).totalIn = Number(totalIn.toFixed(2));
      (variant as any).totalOut = Number(totalOut.toFixed(2));
      (variant as any).totalBalance = Number((totalStart + totalIn - totalOut).toFixed(2));

      (variant as any).totalStartOFR = Number(totalStartOFR.toFixed(2));
      (variant as any).totalInOFR = Number(totalInOFR.toFixed(2));
      (variant as any).totalOutOFR = Number(totalOutOFR.toFixed(2));
      (variant as any).totalBalanceOFR = Number((totalStartOFR + totalInOFR - totalOutOFR).toFixed(2));

      await variantRepo.save(variant as any);
    }

    // 12) JOURNAL VOUCHER for RTN — ✅ use RTN totals (not original totals)
    const jvPrefix = baseIsG ? "JVG" : "JV";

    const lastJV = await queryRunner.manager
      .getRepository(JournalVoucher)
      .createQueryBuilder("jv")
      .where("jv.jvNumber LIKE :prefix", { prefix: `${jvPrefix}${yearSuffix}-%` })
      .orderBy("jv.id", "DESC")
      .getOne();

    const jvSeq = lastJV?.jvNumber ? parseInt(lastJV.jvNumber.split("-")[1]) + 1 : 1;
    const jvNumber = `${jvPrefix}${yearSuffix}-${String(jvSeq).padStart(3, "0")}`;

    const currencyCode = savedRTN.currencyId === 2 ? "LL" : "USD";
    const rate = n(savedRTN.currencyRate);
    const useVAT = n(savedRTN.vatPercentage) > 0;

    const salesRole = currencyCode === "USD" ? "Sales_USD" : "Sales_LL";
    const vatRole = currencyCode === "USD" ? "Vat_USD" : "Vat_LL";

    const salesAccount = await this.accountingResolver.resolveAccount(salesRole, null);
    const vatAccount = useVAT ? await this.accountingResolver.resolveAccount(vatRole, null) : null;

    const total = n(savedRTN.grandTotal);
    const totalWithoutVAT2 = n(savedRTN.totalWithoutVAT);
    const totalVAT2 = n(savedRTN.totalVAT);

    const totalLL = total * rate;
    const totalWithoutVATLL = totalWithoutVAT2 * rate;
    const totalVATLL = totalVAT2 * rate;

    const salesAmount = baseIsG ? totalWithoutVAT2 + totalVAT2 : totalWithoutVAT2;
    const salesAmountLL = baseIsG ? totalWithoutVATLL + totalVATLL : totalWithoutVATLL;

    const getJVFields = (type: "dr" | "cr", val: number, valLL: number) => {
      const fields: any = {
        dr: 0,
        drUSD: 0,
        drLL: 0,
        drOFR: 0,
        drUSDOFR: 0,
        drLLOFR: 0,
        cr: 0,
        crUSD: 0,
        crLL: 0,
        crOFR: 0,
        crUSDOFR: 0,
        crLLOFR: 0,
      };

      if (type === "dr") {
        if (baseIsG) {
          fields.drOFR = val;
          fields.drUSDOFR = val;
          fields.drLLOFR = valLL;
        } else if (baseIsRvr) {
          fields.dr = val;
          fields.drUSD = val;
          fields.drLL = valLL;
        } else {
          fields.dr = val;
          fields.drUSD = val;
          fields.drLL = valLL;
          fields.drOFR = val;
          fields.drUSDOFR = val;
          fields.drLLOFR = valLL;
        }
      } else {
        if (baseIsG) {
          fields.crOFR = val;
          fields.crUSDOFR = val;
          fields.crLLOFR = valLL;
        } else if (baseIsRvr) {
          fields.cr = val;
          fields.crUSD = val;
          fields.crLL = valLL;
        } else {
          fields.cr = val;
          fields.crUSD = val;
          fields.crLL = valLL;
          fields.crOFR = val;
          fields.crUSDOFR = val;
          fields.crLLOFR = valLL;
        }
      }
      return fields;
    };

    const detailPartials: Array<Partial<JournalVoucherDetail>> = [
      {
        customerId: original.customerId,
        description: "فاتورة مرتجع",
        currency: currencyCode,
        docNbr: rtnNumber,
        ...getJVFields("cr", total, totalLL),
      },
      {
        accountId: salesAccount.id,
        description: "مرتجع مبيعات",
        currency: currencyCode,
        docNbr: rtnNumber,
        ...getJVFields("dr", salesAmount, salesAmountLL),
      },
    ];

    if (useVAT && vatAccount && !baseIsG) {
      detailPartials.push({
        accountId: vatAccount.id,
        description: "مرتجع ضريبة القيمة المضافة",
        currency: currencyCode,
        docNbr: rtnNumber,
        ...getJVFields("dr", totalVAT2, totalVATLL),
      });
    }

    const details = this.journalVoucherDetailRepo.create(detailPartials);

    const sum = (field: keyof JournalVoucherDetail) =>
      details.reduce((acc, entry) => acc + n((entry as any)[field]), 0);

    const journalVoucher = this.journalVoucherRepo.create({
      jvNumber,
      jvType: "RTN",
      date: savedRTN.date,
      totalDr: sum("dr"),
      totalDrUSD: sum("drUSD"),
      totalDrLL: sum("drLL"),
      totalDrOFR: sum("drOFR"),
      totalDrUSDOFR: sum("drUSDOFR"),
      totalDrLLOFR: sum("drLLOFR"),
      totalCr: sum("cr"),
      totalCrUSD: sum("crUSD"),
      totalCrLL: sum("crLL"),
      totalCrOFR: sum("crOFR"),
      totalCrUSDOFR: sum("crUSDOFR"),
      totalCrLLOFR: sum("crLLOFR"),
      details,
    });

    await queryRunner.manager.save(JournalVoucher, journalVoucher);

    await queryRunner.commitTransaction();
    return savedRTN;
  } catch (e: any) {
    await queryRunner.rollbackTransaction();
    throw new BadRequestException(e?.message || "Return invoice creation failed");
  } finally {
    await queryRunner.release();
  }
}




  async getAllInvoiceDetailsForView(opts?: {
    type?: 'S' | 'G' | 'RVR' | 'RTN';
    from?: string; // YYYY-MM-DD
    to?: string;   // YYYY-MM-DD
    limit?: number;
  }) {
    const qb = this.invoiceRepository
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.customer', 'cust')
      .leftJoinAndSelect('inv.branch', 'br')
      .leftJoinAndSelect('inv.currency', 'cur')
      .leftJoinAndSelect('inv.items', 'ii')
      .leftJoinAndSelect('ii.itemVariant', 'iv')
      .leftJoinAndSelect('iv.thickness', 'th')
      .leftJoinAndSelect('iv.itemNameDescription', 'desc')
      .orderBy('inv.date', 'DESC')
      .addOrderBy('inv.id', 'DESC')
      .addOrderBy('ii.id', 'ASC');

    // ✅ default: only Sales/Glass (as you said before)
    const types = opts?.type ? [opts.type] : ['S', 'G'];
    qb.andWhere('inv.invoiceType IN (:...types)', { types });

    // optional date filters (DATE column safe as strings)
    if (opts?.from) qb.andWhere('inv.date >= :from', { from: opts.from });
    if (opts?.to) qb.andWhere('inv.date <= :to', { to: opts.to });

    if (opts?.limit && Number.isFinite(opts.limit) && opts.limit > 0) {
      qb.take(opts.limit);
    }

    const invoices = await qb.getMany();

    return invoices.map((inv: any) => ({
      id: inv.id,
      date: inv.date,
      invoiceType: inv.invoiceType,
      invoiceNumber: inv.invoiceNumber,

      customer: inv.customer
        ? { id: inv.customer.id, name: inv.customer.name ?? null }
        : null,

      branch: inv.branch
        ? { id: inv.branch.id, name: inv.branch.name ?? null }
        : null,

      currency: inv.currency
        ? { id: inv.currency.id, code: inv.currency.code ?? null }
        : null,

      totals: {
        totalWithoutVAT: Number(inv.totalWithoutVAT),
        totalVAT: Number(inv.totalVAT),
        grandTotal: Number(inv.grandTotal),
        currencyRate: Number(inv.currencyRate),
        vatPercentage: Number(inv.vatPercentage),
      },

      items: (inv.items ?? []).map((ii: any) => {
        const iv = ii.itemVariant;
        const th = iv?.thickness;
        const desc = iv?.itemNameDescription;

        return {
          id: ii.id,
          invoiceItemId: ii.id,
          itemVariantId: ii.itemVariantId,

          itemName:
            desc?.name ??
            desc?.description ??
            iv?.invoiceDisplayName ??
            null,

          thickness:
            th?.value != null
              ? Number(th.value)
              : th?.thickness != null
              ? Number(th.thickness)
              : null,

          length:
            ii.length != null
              ? Number(ii.length)
              : iv?.length != null
              ? Number(iv.length)
              : null,

          width:
            ii.width != null
              ? Number(ii.width)
              : iv?.width != null
              ? Number(iv.width)
              : null,

          sheetsPerBox:
            ii.sheetsPerBox != null
              ? Number(ii.sheetsPerBox)
              : iv?.sheetsPerBox != null
              ? Number(iv.sheetsPerBox)
              : null,

          quantity: Number(ii.quantity ?? 0),
          sqm: Number(ii.sqm ?? 0),

          unitPrice: Number(ii.unitPrice ?? 0),
          totalAmount: Number(ii.totalAmount ?? 0),
          vat: Number(ii.vat ?? 0),

          averageCost: ii.averageCost != null ? Number(ii.averageCost) : null,
          averageCostC: ii.averageCostC != null ? Number(ii.averageCostC) : null,
          averageCostVM: ii.averageCostVM != null ? Number(ii.averageCostVM) : null,
          averageCostCVM: ii.averageCostCVM != null ? Number(ii.averageCostCVM) : null,

          lastCost: ii.lastCost != null ? Number(ii.lastCost) : null,
          lastCostC: ii.lastCostC != null ? Number(ii.lastCostC) : null,
          lastCostVM: ii.lastCostVM != null ? Number(ii.lastCostVM) : null,
          lastCostCVM: ii.lastCostCVM != null ? Number(ii.lastCostCVM) : null,
        };
      }),
    }));
  }









}

