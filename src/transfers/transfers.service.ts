// src/transfers/transfers.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, IsNull, In } from 'typeorm';
import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { Settings } from '../entities/settings.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Item } from 'src/entities/inventory/item.entity';

import { InventoryTransactionGateway } from '../inventroy-transactions/inventory-transaction.gateway';
import { InventoryTransactionService } from '../inventroy-transactions/inventroy-transactions.service';
import { ItemBatch } from 'src/entities/inventory/itemBatch.entity';
import { InvoiceItem } from 'src/entities/invoiceItem.entity';

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transfersRepo: Repository<Transfer>,

    @InjectRepository(TransferItem)
    private readonly itemsRepo: Repository<TransferItem>,

    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,

    @InjectRepository(InventoryTransaction)
    private readonly inventoryTxRepo: Repository<InventoryTransaction>,

    @InjectRepository(Thickness)
    private readonly thicknessRepo: Repository<Thickness>,

    @InjectRepository(ItemVariant)
    private readonly variantRepo: Repository<ItemVariant>,

    @InjectRepository(ItemBatch)
    private readonly ItemBatch: Repository<ItemBatch>,

      @InjectRepository(InvoiceItem)
    private readonly InvoiceItemRepo: Repository<InvoiceItem>,

    private readonly inventoryTransactionService: InventoryTransactionService,
    private readonly inventoryTransactionGateway: InventoryTransactionGateway,
  ) {}

  /** Logs any NaN-valued numeric property on the passed-in object. */
  private logIfNaN(obj: any, context: string) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number' && isNaN(value)) {
        console.error(`❌ NaN detected in ${context}.${key}`, obj);
      }
    }
  }

async create(data: any): Promise<Transfer> {
  console.log(
    '🛠️ TransfersService.create payload:',
    JSON.stringify(data, null, 2),
  );

  let savedTransfer: Transfer;

  await this.transfersRepo.manager.transaction(
    async (manager: EntityManager) => {
      //
      // 🔐 Safe numeric helper (prevents NaN)
      //
      const num = (v: any): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      //
      // 1) Fetch active Settings → year suffix
      //
      const setting = await manager.getRepository(Settings).findOne({
        where: { isActive: true },
      });
      if (!setting) {
        throw new NotFoundException('No active year found in Settings');
      }
      const year2 = setting.year.slice(-2);

      //
      // 2) Determine prefix by data.location
      //
      let prefix: string;
      switch (data.location) {
        case 'Adjustment +':
        case 'Adjustment -':
          prefix = 'ADJ';
          break;
        case 'Breakage':
          prefix = 'BR';
          break;
        case 'Defects':
          prefix = 'DEF';
          break;
        default:
          prefix = 'TR';
      }

      //
      // 3) Find last transferNumber matching prefix+year
      //
      const last = await manager
        .getRepository(Transfer)
        .createQueryBuilder('t')
        .where('t.transferNumber LIKE :pattern', {
          pattern: `${prefix}${year2}-%`,
        })
        .orderBy('t.id', 'DESC')
        .getOne();

      //
      // 4) Compute next sequence
      //
      let next = 1;
      if (last) {
        const parts = last.transferNumber.split('-');
        next = parseInt(parts[1], 10) + 1;
      }
      const seqPadded = String(next).padStart(2, '0');

      //
      // 5) Build and save the Transfer row
      //
      const transferNumber = `${prefix}${year2}-${seqPadded}`;
      const transfer = manager.getRepository(Transfer).create({
        transferNumber,
        date: data.date,
        type: data.type,
        location: data.location,
        items: (data.items || []).map((i: any) =>
          manager.getRepository(TransferItem).create({
            itemBatchId: i.itemBatchId,
            quantity: i.quantity,
            sqm: i.sqm,
            price: i.price,
          }),
        ),
      });
      savedTransfer = await manager.getRepository(Transfer).save(transfer);

      //
      // 6) Load each saved TransferItem ↔ itemVariant → thickness → item
      //
      const persisted = await manager.getRepository(TransferItem).find({
        where: { transferId: savedTransfer.id },
        relations: [
          'itemBatch',
          'itemBatch.itemVariant',
          'itemBatch.itemVariant.thickness',
          'itemBatch.itemVariant.thickness.item',
        ],
      });

      //
      // 7) JF: “box → sheet” logic (throws if any non-“box” found)
      //
    if (data.location === 'JF') {
        for (const ti of persisted) {
          const qtyBoxes = num(ti.quantity); // number of boxes selected
          const fromBatch = ti.itemBatch;    // Box batch
          const fromVariant = fromBatch.itemVariant;
          const parentItem = fromVariant.thickness.item;

          if (parentItem.type !== 'box') {
            throw new BadRequestException(
              `JF transfers only accept box-type items. Found ${parentItem.itemName} (${parentItem.type})`,
            );
          }

          //
          // Find matching sheet thickness for this itemName + thickness
          //
          const sheetThickness = await manager
            .getRepository(Thickness)
            .createQueryBuilder('th')
            .innerJoin(
              'th.item',
              'it',
              'it.itemName = :name AND it.type = :type',
              {
                name: parentItem.itemName,
                type: 'sheet',
              },
            )
            .where('th.thickness = :thick', {
              thick: fromVariant.thickness.thickness,
            })
            .getOne();

          if (!sheetThickness) {
            throw new NotFoundException(
              `No sheet-type thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
            );
          }

          //
          // Find sheet variant with same origin + dimensions
          //
          const sheetVariant = await manager
            .getRepository(ItemVariant)
            .findOne({
              where: {
                thickness: { id: sheetThickness.id } as any,
                origin: fromVariant.origin,
                length: fromVariant.length,
                width: fromVariant.width,
              },
            });

          if (!sheetVariant) {
            throw new NotFoundException(
              `No sheet variant for ${parentItem.itemName} @ ${fromVariant.length}×${fromVariant.width} origin=${fromVariant.origin}`,
            );
          }

          //
          // Compute sheet count + sqm based on the BOX variant:
          //
          const sheetsPerBox = num(fromVariant.sheetsPerBox);
          const sheetCount = qtyBoxes * sheetsPerBox; // sheets to add

          const lengthM = num(fromVariant.length) / 100;
          const widthM = num(fromVariant.width) / 100;
          const sheetArea = lengthM * widthM; // sqm per sheet
          const totalSqm = sheetCount * sheetArea;

          //
          // Find / Create destination SHEET batch (same condition + date)
          //
          let toBatch = await manager.getRepository(ItemBatch).findOne({
            where: {
              itemVariant: { id: sheetVariant.id },
              condition: fromBatch.condition,
              dateReceived: fromBatch.dateReceived,
            },
          });

          if (!toBatch) {
            toBatch = manager.getRepository(ItemBatch).create({
              itemVariant: sheetVariant,
              condition: fromBatch.condition,
              dateReceived: fromBatch.dateReceived,
            });
            await manager.getRepository(ItemBatch).save(toBatch);
          }

          // ✅ InventoryTransaction: Box → Out
          //    - quantityofr: boxes
          //    - sqmofr: sqm
          const txOut = manager.getRepository(InventoryTransaction).create({
            itemVariantId: fromVariant.id,
            itemBatchId: fromBatch.id,
            transactionType: 'MovedFrom',
            quantity: 0,
            quantityofr: -qtyBoxes, // boxes out
            sqm: 0,
            sqmofr: -totalSqm,      // sqm out
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log(
            '📤 JF txOut (box → sheet):',
            JSON.stringify(
              {
                qtyBoxes,
                sheetCount,
                totalSqm,
                txOut,
              },
              null,
              2,
            ),
          );
          this.logIfNaN(txOut, 'txOut');
          await manager.getRepository(InventoryTransaction).save(txOut);

          // ✅ InventoryTransaction: Sheet → In
          //    - quantityofr: sheets
          //    - sqmofr: sqm
          const txIn = manager.getRepository(InventoryTransaction).create({
            itemVariantId: sheetVariant.id,
            itemBatchId: toBatch.id,
            transactionType: 'MovedTo',
            quantity: 0,
            quantityofr: sheetCount, // sheets in
            sqm: 0,
            sqmofr: totalSqm,        // sqm in
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log(
            '📥 JF txIn (box → sheet):',
            JSON.stringify(
              {
                qtyBoxes,
                sheetCount,
                totalSqm,
                txIn,
              },
              null,
              2,
            ),
          );
          this.logIfNaN(txIn, 'txIn');
          await manager.getRepository(InventoryTransaction).save(txIn);

          // ✅ Update FROM (box) batch OFR totals (sqm-based)
          fromBatch.outOFR = num(fromBatch.outOFR) + totalSqm;
          fromBatch.balanceOFR =
            num(fromBatch.startOFR) +
            num(fromBatch.inOFR) -
            num(fromBatch.outOFR);
          await manager.getRepository(ItemBatch).save(fromBatch);

          // ✅ Update TO (sheet) batch OFR totals (sqm-based)
          toBatch.inOFR = num(toBatch.inOFR) + totalSqm;
          toBatch.balanceOFR =
            num(toBatch.startOFR) +
            num(toBatch.inOFR) -
            num(toBatch.outOFR);
          await manager.getRepository(ItemBatch).save(toBatch);

          // ✅ Update FROM (box) Variant OFR totals (sqm-based)
          fromVariant.totalOutOFR = num(fromVariant.totalOutOFR) + totalSqm;
          fromVariant.totalBalanceOFR =
            num(fromVariant.totalStartOFR) +
            num(fromVariant.totalInOFR) -
            num(fromVariant.totalOutOFR);

          // ✅ Update TO (sheet) Variant OFR totals (sqm-based)
          sheetVariant.totalInOFR = num(sheetVariant.totalInOFR) + totalSqm;
          sheetVariant.totalBalanceOFR =
            num(sheetVariant.totalStartOFR) +
            num(sheetVariant.totalInOFR) -
            num(sheetVariant.totalOutOFR);

          await manager
            .getRepository(ItemVariant)
            .save([fromVariant, sheetVariant]);
        }
      }

      //
if (data.location === 'FJ') {
  for (const ti of persisted) {
    const qty = num(ti.quantity);
    const sqmVal = num(ti.sqm);

    const fromBatch = ti.itemBatch; // Sheet batch
    const fromVariant = fromBatch.itemVariant;
    const parentItem = fromVariant.thickness.item;

    if (parentItem.type !== 'sheet') {
      throw new BadRequestException(
        `FJ transfers only accept sheet-type items. Found ${parentItem.itemName} (${parentItem.type})`,
      );
    }

    // ✅ 1) Find matching raw payload line by itemBatchId
    const rawItem = (data.items ?? []).find(
      (row: any) => Number(row.itemBatchId) === ti.itemBatchId,
    );

    if (!rawItem || !rawItem.toItemVariantId) {
      throw new BadRequestException(
        'FJ transfer requires "toItemVariantId" (target box ItemVariant) on each line.',
      );
    }

    const boxVariantId = Number(rawItem.toItemVariantId);

    // ✅ 2) Load the target BOX variant (must be type "box")
    const boxVariant = await manager.getRepository(ItemVariant).findOne({
      where: { id: boxVariantId },
      relations: ['thickness', 'thickness.item'],
    });

    if (!boxVariant) {
      throw new NotFoundException(
        `Target box ItemVariant ${boxVariantId} not found.`,
      );
    }

    const boxItem = boxVariant.thickness.item;

    if (boxItem.type !== 'box') {
      throw new BadRequestException(
        `FJ target must be a "box" item. Got ${boxItem.itemName} (${boxItem.type}).`,
      );
    }

    // (Optional but safer) same itemName + same thickness
    if (boxItem.itemName !== parentItem.itemName) {
      throw new BadRequestException(
        `FJ target box "${boxItem.itemName}" doesn't match sheet item "${parentItem.itemName}".`,
      );
    }

    if (boxVariant.thickness.thickness !== fromVariant.thickness.thickness) {
      throw new BadRequestException(
        `FJ target thickness ${boxVariant.thickness.thickness} differs from sheet thickness ${fromVariant.thickness.thickness}.`,
      );
    }

    // ✅ 3) sheetsPerBox we want to show in the "sheets" column
    const sheetsPerBox = num((boxVariant as any).sheetsPerBox);

    // ✅ 4) Find / create destination BOX batch
    let toBatch = await manager.getRepository(ItemBatch).findOne({
      where: {
        itemVariant: { id: boxVariant.id },
        condition: fromBatch.condition,
        dateReceived: fromBatch.dateReceived,
      },
    });

    if (!toBatch) {
      toBatch = manager.getRepository(ItemBatch).create({
        itemVariant: boxVariant,
        condition: fromBatch.condition,
        dateReceived: fromBatch.dateReceived,
      });
      await manager.getRepository(ItemBatch).save(toBatch);
    }

    //
    // ✅ 5) InventoryTransaction: SHEET → Out
    //    quantityofr = -sheetsPerBox  (🔹 show sheetsPerBox, not qty)
    //
    const txOut = manager.getRepository(InventoryTransaction).create({
      itemVariantId: fromVariant.id,
      itemBatchId: fromBatch.id,
      transactionType: 'MovedFrom',
      quantity: 0,
      quantityofr: -sheetsPerBox,
      sqm: 0,
      sqmofr: -sqmVal,
      finalcost: 0,
      finalcostofr: 0,
      transferId: savedTransfer.id,
      dateForEachInvoice: new Date(savedTransfer.date),
    });
    console.log('📥 FJ about to save txOut:', JSON.stringify(txOut, null, 2));
    this.logIfNaN(txOut, 'txOut');
    await manager.getRepository(InventoryTransaction).save(txOut);

    //
    // ✅ 6) InventoryTransaction: BOX → In
    //    quantityofr = sheetsPerBox  (🔹 show sheetsPerBox, not qty)
    //
    const txIn = manager.getRepository(InventoryTransaction).create({
      itemVariantId: boxVariant.id,
      itemBatchId: toBatch.id,
      transactionType: 'MovedTo',
      quantity: 0,
      quantityofr: qty,
      sqm: 0,
      sqmofr: sqmVal,
      finalcost: 0,
      finalcostofr: 0,
      transferId: savedTransfer.id,
      dateForEachInvoice: new Date(savedTransfer.date),
    });
    console.log('📥 FJ about to save txIn:', JSON.stringify(txIn, null, 2));
    this.logIfNaN(txIn, 'txIn');
    await manager.getRepository(InventoryTransaction).save(txIn);

    //
    // ✅ 7) Update FROM (sheet) batch
    //
    fromBatch.outOFR = num(fromBatch.outOFR) + sqmVal;
    fromBatch.balanceOFR =
      num(fromBatch.startOFR) +
      num(fromBatch.inOFR) -
      num(fromBatch.outOFR);
    await manager.getRepository(ItemBatch).save(fromBatch);

    //
    // ✅ 8) Update TO (box) batch
    //
    toBatch.inOFR = num(toBatch.inOFR) + sqmVal;
    toBatch.balanceOFR =
      num(toBatch.startOFR) +
      num(toBatch.inOFR) -
      num(toBatch.outOFR);
    await manager.getRepository(ItemBatch).save(toBatch);

    //
    // ✅ 9) Update FROM (sheet) Variant totals
    //
    fromVariant.totalOutOFR = num(fromVariant.totalOutOFR) + sqmVal;
    fromVariant.totalBalanceOFR =
      num(fromVariant.totalStartOFR) +
      num(fromVariant.totalInOFR) -
      num(fromVariant.totalOutOFR);

    //
    // ✅ 10) Update TO (box) Variant totals
    //
    boxVariant.totalInOFR = num(boxVariant.totalInOFR) + sqmVal;
    boxVariant.totalBalanceOFR =
      num(boxVariant.totalStartOFR) +
      num(boxVariant.totalInOFR) -
      num(boxVariant.totalOutOFR);

    await manager.getRepository(ItemVariant).save([fromVariant, boxVariant]);
  }
}




      //
      // 9) SL: “(box or sheet) → sqm”  (BOSTS)
      //
      if (data.location === 'BOSTS') {
        for (const ti of persisted) {
          const qty = num(ti.quantity);
          const sqmVal = num(ti.sqm);

          const fromBatch = ti.itemBatch;
          const fromVariant = fromBatch.itemVariant;
          const parentItem = fromVariant.thickness.item;

          // ✅ Skip if not box or sheet
          if (parentItem.type !== 'box' && parentItem.type !== 'sheet') continue;

          // ✅ Calculate sheet area
          const lengthM = num(fromVariant.length) / 100;
          const widthM = num(fromVariant.width) / 100;
          const sheetArea = lengthM * widthM;

          let totalSqm = 0;
          if (parentItem.type === 'box') {
            totalSqm = qty * num(fromVariant.sheetsPerBox) * sheetArea;
          } else if (parentItem.type === 'sheet') {
            totalSqm = qty * sheetArea;
          }

          // ✅ Find "sqm" thickness for this item
          const sqmThickness = await manager
            .getRepository(Thickness)
            .createQueryBuilder('th')
            .innerJoin(
              'th.item',
              'it',
              'it.itemName = :name AND it.type = :type',
              {
                name: parentItem.itemName,
                type: 'sqm',
              },
            )
            .where('th.thickness = :thick', {
              thick: fromVariant.thickness.thickness,
            })
            .getOne();

          if (!sqmThickness) {
            throw new NotFoundException(
              `No "sqm" thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
            );
          }

          // 🔁 Get ALL sqm variants for this item+thickness (ignore origin)
          const sqmVariants = await manager.getRepository(ItemVariant).find({
            where: {
              thickness: { id: sqmThickness.id } as any,
            },
          });

          if (!sqmVariants.length) {
            throw new NotFoundException(
              `No sqm variant for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}`,
            );
          }

          // ✅ Must pick one that has realDescriptionId; if none → error
          const sqmVariant = sqmVariants.find(
            (v: any) =>
              v.realDescriptionId !== null &&
              v.realDescriptionId !== undefined,
          );

          if (!sqmVariant) {
            throw new NotFoundException(
              `No sqm variant with realDescriptionId for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}`,
            );
          }

          // ✅ Find / Create destination sqm batch
          let toBatch = await manager.getRepository(ItemBatch).findOne({
            where: {
              itemVariant: { id: sqmVariant.id },
              condition: fromBatch.condition,
              dateReceived: fromBatch.dateReceived,
            },
          });

          if (!toBatch) {
            toBatch = manager.getRepository(ItemBatch).create({
              itemVariant: sqmVariant,
              condition: fromBatch.condition,
              dateReceived: fromBatch.dateReceived,
            });
            await manager.getRepository(ItemBatch).save(toBatch);
          }

          //
          // ✅ InventoryTransaction → Deduct from source batch
          //
          const txOut = manager.getRepository(InventoryTransaction).create({
            itemVariantId: fromVariant.id,
            itemBatchId: fromBatch.id,
            transactionType: 'MovedFrom',
            quantity: 0,
            quantityofr: -qty,
            sqm: 0,
            sqmofr: -totalSqm,
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log('📥 about to save txOut:', JSON.stringify(txOut, null, 2));
          this.logIfNaN(txOut, 'txOut');
          await manager.getRepository(InventoryTransaction).save(txOut);

          //
          // ✅ InventoryTransaction → Add to sqm batch
          //
          const txIn = manager.getRepository(InventoryTransaction).create({
            itemVariantId: sqmVariant.id,
            itemBatchId: toBatch.id,
            transactionType: 'MovedTo',
            quantity: 0,
            quantityofr: totalSqm,
            sqm: 0,
            sqmofr: totalSqm,
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log('📥 about to save txIn:', JSON.stringify(txIn, null, 2));
          this.logIfNaN(txIn, 'txIn');
          await manager.getRepository(InventoryTransaction).save(txIn);

          //
          // ✅ Update FROM Batch (box or sheet)
          //
          fromBatch.outOFR = num(fromBatch.outOFR) + totalSqm;
          fromBatch.balanceOFR =
            num(fromBatch.startOFR) +
            num(fromBatch.inOFR) -
            num(fromBatch.outOFR);
          await manager.getRepository(ItemBatch).save(fromBatch);

          //
          // ✅ Update TO Batch (sqm)
          //
          toBatch.inOFR = num(toBatch.inOFR) + totalSqm;
          toBatch.balanceOFR =
            num(toBatch.startOFR) +
            num(toBatch.inOFR) -
            num(toBatch.outOFR);
          await manager.getRepository(ItemBatch).save(toBatch);

          //
          // ✅ Update FROM Variant (box/sheet) Totals
          //
          fromVariant.totalOutOFR = num(fromVariant.totalOutOFR) + totalSqm;
          fromVariant.totalBalanceOFR =
            num(fromVariant.totalStartOFR) +
            num(fromVariant.totalInOFR) -
            num(fromVariant.totalOutOFR);

          //
          // ✅ Update TO Variant (sqm) Totals
          //
          (sqmVariant as any).totalInOFR =
            num((sqmVariant as any).totalInOFR) + totalSqm;
          (sqmVariant as any).totalBalanceOFR =
            num((sqmVariant as any).totalStartOFR) +
            num((sqmVariant as any).totalInOFR) -
            num((sqmVariant as any).totalOutOFR);

          await manager
            .getRepository(ItemVariant)
            .save([fromVariant, sqmVariant as any]);
        }
      }

      //
      if (data.location === 'STBOS') {
        for (const ti of persisted) {
          const qty = num(ti.quantity);
          const sqmVal = num(ti.sqm);

          const toBatch = ti.itemBatch;
          const destVariant = toBatch.itemVariant;
          const parentItem = destVariant.thickness.item;

          if (parentItem.type !== 'box' && parentItem.type !== 'sheet') {
            continue;
          }

          //
          // ✅ Step 1: Find original SQM thickness (same itemName, thickness)
          //
          const sqmThickness = await manager
            .getRepository(Thickness)
            .createQueryBuilder('th')
            .innerJoin(
              'th.item',
              'it',
              'it.itemName = :nm AND it.type = :tp',
              {
                nm: parentItem.itemName,
                tp: 'sqm',
              },
            )
            .where('th.thickness = :val', {
              val: destVariant.thickness.thickness,
            })
            .getOne();

          if (!sqmThickness) {
            throw new NotFoundException(
              `No sqm thickness ${destVariant.thickness.thickness} for ${parentItem.itemName}`,
            );
          }

          // 🔁 Get ALL sqm variants for this item+thickness (ignore origin)
          const sqmVariants = await manager.getRepository(ItemVariant).find({
            where: {
              thickness: { id: sqmThickness.id } as any,
            },
          });

          if (!sqmVariants.length) {
            throw new NotFoundException(
              `No sqm variant for ${parentItem.itemName}, thickness=${destVariant.thickness.thickness}`,
            );
          }

          // ✅ Must pick one that has realDescriptionId; if none → error
          const sqmVariant = sqmVariants.find(
            (v: any) =>
              v.realDescriptionId !== null &&
              v.realDescriptionId !== undefined,
          );

          if (!sqmVariant) {
            throw new NotFoundException(
              `No sqm variant with realDescriptionId for ${parentItem.itemName}, thickness=${destVariant.thickness.thickness}`,
            );
          }

          //
          // ✅ Step 2: Find / Create source sqm batch (same condition and dateReceived as destination)
          //
          let fromBatch = await manager.getRepository(ItemBatch).findOne({
            where: {
              itemVariant: { id: sqmVariant.id },
              condition: toBatch.condition,
              dateReceived: toBatch.dateReceived,
            },
          });

          if (!fromBatch) {
            fromBatch = manager.getRepository(ItemBatch).create({
              itemVariant: sqmVariant,
              condition: toBatch.condition,
              dateReceived: toBatch.dateReceived,
            });
            await manager.getRepository(ItemBatch).save(fromBatch);
          }

          //
          // ✅ Step 3: Create InventoryTransaction → Deduct from sqm batch
          //
          const txOut = manager.getRepository(InventoryTransaction).create({
            itemVariantId: sqmVariant.id,
            itemBatchId: fromBatch.id,
            transactionType: 'MovedFrom',
            quantity: 0,
            quantityofr: -sqmVal,
            sqm: 0,
            sqmofr: -sqmVal,
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log('📥 about to save txout:', JSON.stringify(txOut, null, 2));
          this.logIfNaN(txOut, 'txOut');
          await manager.getRepository(InventoryTransaction).save(txOut);

          //
          // ✅ Step 4: Create InventoryTransaction → Credit box/sheet batch
          //
          const txIn = manager.getRepository(InventoryTransaction).create({
            itemVariantId: destVariant.id,
            itemBatchId: toBatch.id,
            transactionType: 'MovedTo',
            quantity: 0,
            quantityofr: qty,
            sqm: 0,
            sqmofr: sqmVal,
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log('📥 about to save txIn:', JSON.stringify(txIn, null, 2));
          this.logIfNaN(txIn, 'txIn');
          await manager.getRepository(InventoryTransaction).save(txIn);

          //
          // ✅ Step 5: Update FROM batch (sqm)
          //
          fromBatch.outOFR = num(fromBatch.outOFR) + sqmVal;
          fromBatch.balanceOFR =
            num(fromBatch.startOFR) +
            num(fromBatch.inOFR) -
            num(fromBatch.outOFR);
          await manager.getRepository(ItemBatch).save(fromBatch);

          //
          // ✅ Step 6: Update TO batch (box/sheet)
          //
          toBatch.inOFR = num(toBatch.inOFR) + sqmVal;
          toBatch.balanceOFR =
            num(toBatch.startOFR) +
            num(toBatch.inOFR) -
            num(toBatch.outOFR);
          await manager.getRepository(ItemBatch).save(toBatch);

          //
          // ✅ Step 7: Update FROM variant (sqm)
          //
          (sqmVariant as any).totalOutOFR =
            num((sqmVariant as any).totalOutOFR) + sqmVal;
          (sqmVariant as any).totalBalanceOFR =
            num((sqmVariant as any).totalStartOFR) +
            num((sqmVariant as any).totalInOFR) -
            num((sqmVariant as any).totalOutOFR);

          //
          // ✅ Step 8: Update TO variant (box/sheet)
          //
          destVariant.totalInOFR = num(destVariant.totalInOFR) + sqmVal;
          destVariant.totalBalanceOFR =
            num(destVariant.totalStartOFR) +
            num(destVariant.totalInOFR) -
            num(destVariant.totalOutOFR);

          await manager
            .getRepository(ItemVariant)
            .save([sqmVariant as any, destVariant]);
        }
      }

      // 7) BR: “Breakage” → Deduct quantity and sqm from inventory
      //
      if (data.location === 'Breakage') {
        for (const ti of persisted) {
          const qty = num(ti.quantity);
          const sqmVal = num(ti.sqm);

          const batch = ti.itemBatch;
          const variant = batch.itemVariant;

          // Create InventoryTransaction
          const txOut = manager.getRepository(InventoryTransaction).create({
            itemVariantId: variant.id,
            itemBatchId: batch.id,
            transactionType: 'Breakage',
            quantity: 0,
            quantityofr: -qty,
            sqm: 0,
            sqmofr: -sqmVal,
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log('📥 about to save txOut:', JSON.stringify(txOut, null, 2));
          this.logIfNaN(txOut, 'txOut');
          await manager.getRepository(InventoryTransaction).save(txOut);

          // Update Batch
          batch.outOFR = num(batch.outOFR) + sqmVal;
          batch.balanceOFR =
            num(batch.startOFR) +
            num(batch.inOFR) -
            num(batch.outOFR);
          await manager.getRepository(ItemBatch).save(batch);

          // Update Variant Totals
          variant.totalOutOFR = num(variant.totalOutOFR) + sqmVal;
          variant.totalBalanceOFR =
            num(variant.totalStartOFR) +
            num(variant.totalInOFR) -
            num(variant.totalOutOFR);
          await manager.getRepository(ItemVariant).save(variant);
        }
      }

      // 8) Adjustment + → Add sqmOFR to batch and variant
      if (data.location === 'Adjustment +') {
        for (const ti of persisted) {
          const qty = num(ti.quantity);
          const sqmVal = num(ti.sqm);

          const batch = ti.itemBatch;
          const variant = batch.itemVariant;

          const txIn = manager.getRepository(InventoryTransaction).create({
            itemVariantId: variant.id,
            itemBatchId: batch.id,
            transactionType: 'Adjustment +',
            quantity: 0,
            quantityofr: qty,
            sqm: 0,
            sqmofr: sqmVal,
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log('📥 about to save txIn:', JSON.stringify(txIn, null, 2));
          this.logIfNaN(txIn, 'txIn');
          await manager.getRepository(InventoryTransaction).save(txIn);

          // Update Batch
          batch.inOFR = num(batch.inOFR) + sqmVal;
          batch.balanceOFR =
            num(batch.startOFR) +
            num(batch.inOFR) -
            num(batch.outOFR);
          await manager.getRepository(ItemBatch).save(batch);

          // Update Variant Totals
          variant.totalInOFR = num(variant.totalInOFR) + sqmVal;
          variant.totalBalanceOFR =
            num(variant.totalStartOFR) +
            num(variant.totalInOFR) -
            num(variant.totalOutOFR);
          await manager.getRepository(ItemVariant).save(variant);
        }
      }

      // 9) Adjustment - → Subtract sqmOFR from batch and variant
      if (data.location === 'Adjustment -') {
        for (const ti of persisted) {
          const qty = num(ti.quantity);
          const sqmVal = num(ti.sqm);

          const batch = ti.itemBatch;
          const variant = batch.itemVariant;

          const txOut = manager.getRepository(InventoryTransaction).create({
            itemVariantId: variant.id,
            itemBatchId: batch.id,
            transactionType: 'Adjustment -',
            quantity: 0,
            quantityofr: -qty,
            sqm: 0,
            sqmofr: -sqmVal,
            finalcost: 0,
            finalcostofr: 0,
            transferId: savedTransfer.id,
            dateForEachInvoice: new Date(savedTransfer.date),
          });
          console.log('📥 about to save txOut:', JSON.stringify(txOut, null, 2));
          this.logIfNaN(txOut, 'txOut');
          await manager.getRepository(InventoryTransaction).save(txOut);

          // Update Batch
          batch.outOFR = num(batch.outOFR) + sqmVal;
          batch.balanceOFR =
            num(batch.startOFR) +
            num(batch.inOFR) -
            num(batch.outOFR);
          await manager.getRepository(ItemBatch).save(batch);

          // Update Variant Totals
          variant.totalOutOFR = num(variant.totalOutOFR) + sqmVal;
          variant.totalBalanceOFR =
            num(variant.totalStartOFR) +
            num(variant.totalInOFR) -
            num(variant.totalOutOFR);
          await manager.getRepository(ItemVariant).save(variant);
        }
      }

      // ✅ Emit WebSocket update with latest inventory activity
      const updatedActivity =
        await this.inventoryTransactionService.getActivity();
      this.inventoryTransactionGateway.sendActivityUpdate(updatedActivity);

      // If we reach here without throwing, commit the transaction:
    },
  );

  setTimeout(async () => {
    const updatedActivity =
      await this.inventoryTransactionService.getActivity();
    this.inventoryTransactionGateway.sendActivityUpdate(updatedActivity);
  }, 100);

  return savedTransfer;
}



  async findAll(): Promise<Transfer[]> {
    return this.transfersRepo.find({ relations: ['items'] });
  }

  async findOne(id: number): Promise<Transfer> {
    const t = await this.transfersRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!t) throw new NotFoundException(`Transfer #${id} not found`);
    return t;
  }

  async finddetails(): Promise<Transfer[]> {
    return this.transfersRepo.find({
      relations: [
        'items',
        'items.itemBatch',
        'items.itemBatch.itemVariant',
        'items.itemBatch.itemVariant.thickness',
        'items.itemBatch.itemVariant.thickness.item',
      ],
      order: { id: 'DESC' },
    });
  }



   async getCutsQueue(opts?: {
    page?: number;
    limit?: number;
    status?: 'pending' | 'resolved' | 'all';
    from?: string; // YYYY-MM-DD
    to?: string;   // YYYY-MM-DD
    q?: string;
  }) {
    const page = Math.max(1, Number(opts?.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));
    const start = (page - 1) * limit;

    const status = String(opts?.status ?? 'pending').toLowerCase() as
      | 'pending'
      | 'resolved'
      | 'all';

    const q = String(opts?.q ?? '').trim();
    const from = opts?.from ? String(opts.from).slice(0, 10) : null;
    const to = opts?.to ? String(opts.to).slice(0, 10) : null;

    // 1) build base query for IDs (avoid duplicates caused by sqmPieces joins)
    const base = this.itemsRepo
      .createQueryBuilder('ti')
      .leftJoin('ti.transfer', 't')
      .leftJoin('ti.itemVariant', 'v')
      .leftJoin('v.thickness', 'th')
      .leftJoin('th.item', 'item')
      .leftJoin('ti.itemBatch', 'batch')
      .leftJoin('ti.invoiceItem', 'ii')
      .leftJoin('ii.invoice', 'inv')
      .leftJoin('inv.customer', 'cust')
      .where('ti.invoiceItemId IS NOT NULL'); // ✅ only “cuts” we can prove

    // status
    if (status === 'pending') {
      base.andWhere('ti.sqmTrashUnallocated > 0');
    } else if (status === 'resolved') {
      base.andWhere('ti.sqmTrashUnallocated <= 0');
    }

    // date range (transfer.date)
    if (from) base.andWhere('t.date >= :from', { from });
    if (to) base.andWhere('t.date <= :to', { to });

    // search
    if (q) {
      base.andWhere(
        `(
          inv.invoiceNumber LIKE :q
          OR CAST(inv.id AS CHAR) LIKE :q
          OR cust.customerName LIKE :q
          OR item.itemName LIKE :q
          OR v.origin LIKE :q
          OR CAST(batch.id AS CHAR) LIKE :q
        )`,
        { q: `%${q}%` },
      );
    }

    // count distinct ids
    const countRow = await base
      .clone()
      .select('COUNT(DISTINCT ti.id)', 'cnt')
      .getRawOne<{ cnt: string }>();

    const total = Number(countRow?.cnt ?? 0);

    // page ids
const idRows = await base
  .clone()
  .select('ti.id', 'id')
  .addSelect('t.date', 'tdate')     // ✅ include order-by column
  .distinct(true)                  // ✅ keep distinct
  .orderBy('t.date', 'DESC')
  .addOrderBy('ti.id', 'DESC')
  .offset(start)
  .limit(limit)
  .getRawMany<{ id: string; tdate: string }>();

const ids = idRows
  .map((r) => Number(r.id))
  .filter((n) => Number.isFinite(n));

    if (!ids.length) {
      return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
        data: [],
      };
    }

    // 2) load full rows with relations
    const items = await this.itemsRepo.find({
      where: { id: In(ids) },
      relations: {
        transfer: true,
        itemVariant: { thickness: { item: true } },
        itemBatch: true,
        sqmPieces: true,
        invoiceItem: { invoice: { customer: true } },
      } as any,
    });

    // keep same order as ids
    const byId = new Map(items.map((x) => [Number(x.id), x]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as TransferItem[];

    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const data = ordered.map((ti) => {
      const v: any = ti.itemVariant;
      const item: any = v?.thickness?.item;

      const ii: any = ti.invoiceItem;
      const inv: any = ii?.invoice;
      const cust: any = inv?.customer;

      const original = {
        length: num(v?.length),
        width: num(v?.width),
        sheetsPerBox: num(v?.sheetsPerBox),
      };

      const snapshot = {
        length: ii?.length == null ? null : num(ii.length),
        width: ii?.width == null ? null : num(ii.width),
        sheetsPerBox: ii?.sheetsPerBox == null ? null : num(ii.sheetsPerBox),
      };

      const changed =
        snapshot.length != null && snapshot.width != null
          ? {
              length: Math.abs(num(snapshot.length) - original.length) > 0.001,
              width: Math.abs(num(snapshot.width) - original.width) > 0.001,
              sheetsPerBox:
                snapshot.sheetsPerBox != null &&
                Math.abs(num(snapshot.sheetsPerBox) - original.sheetsPerBox) > 0.1,
            }
          : { length: false, width: false, sheetsPerBox: false };

      const pieces = Array.isArray((ti as any).sqmPieces) ? (ti as any).sqmPieces : [];
      const piecesSum = pieces.reduce((s: number, p: any) => s + num(p?.sqm), 0);

      const remaining = num((ti as any).sqmTrashUnallocated);
      const status =
        remaining > 0 ? 'pending' : piecesSum > 0 ? 'stocked' : 'trashed';

      return {
        transferId: (ti as any).transferId ?? (ti as any).transfer?.id ?? null,
        transferItemId: ti.id,
        transferDate: (ti as any).transfer?.date ?? null,
        transferNumber: (ti as any).transfer?.transferNumber ?? null,

        invoiceId: inv?.id ?? null,
        invoiceNumber: inv?.invoiceNumber ?? null,
        invoiceDate: inv?.date ?? null,
        customerName: cust?.customerName ?? null,

        invoiceItemId: ii?.id ?? ti.invoiceItemId ?? null,

        itemName: item?.itemName ?? null,
        itemType: String(item?.type ?? '').toLowerCase(),          // box/sheet/sqm/unit
        stockMode: String(item?.stockMode ?? '').toUpperCase(),    // SQM/QTY/NONE

        itemVariantId: ti.itemVariantId ?? v?.id ?? null,
        itemBatchId: ti.itemBatchId ?? (ti as any).itemBatch?.id ?? null,
        origin: v?.origin ?? null,

        sold: {
          sqm: ii?.sqm == null ? null : num(ii.sqm),
          quantity: ii?.quantity == null ? null : num(ii.quantity),
          snapshotDims: snapshot,
          originalDims: original,
          changed,
        },

        stock: {
          consumedSqm: num((ti as any).sqm),
          remainingSqm: remaining,
          piecesSum: Number(piecesSum.toFixed(4)),
          pieces: pieces.map((p: any) => ({
            id: p?.id ?? null,
            sqm: num(p?.sqm),
          })),
          status,
        },
      };
    });

    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
      data,
    };
  }


  async getInvoiceDimChanges(opts?: {
  page?: number;
  limit?: number;
  q?: string;
}) {
  const page = Math.max(1, Number(opts?.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50)));
  const start = (page - 1) * limit;

  const q = String(opts?.q ?? '').trim();

  // tolerances (because decimals)
  const tolLenWid = 0.001;
  const tolSpb = 0.1;

  const qb = this.InvoiceItemRepo
    .createQueryBuilder('ii')
    .leftJoin('ii.invoice', 'inv')
    .leftJoin('inv.customer', 'cust')
    .leftJoin('ii.itemVariant', 'v')
    .leftJoin('v.thickness', 'th')
    .leftJoin('th.item', 'item')
    .where('ii.itemVariantId IS NOT NULL')
    // only compare when snapshot fields are present
    .andWhere(
      `(
        (ii.length IS NOT NULL AND ABS(ii.length - v.length) > :tolLenWid)
        OR
        (ii.width IS NOT NULL AND ABS(ii.width - v.width) > :tolLenWid)
        OR
        (ii.sheetsPerBox IS NOT NULL AND ABS(ii.sheetsPerBox - v.sheetsPerBox) > :tolSpb)
      )`,
      { tolLenWid, tolSpb },
    );

  if (q) {
    qb.andWhere(
      `(
        inv.invoiceNumber LIKE :q
        OR CAST(inv.id AS CHAR) LIKE :q
        OR cust.customerName LIKE :q
        OR item.itemName LIKE :q
        OR v.origin LIKE :q
        OR CAST(ii.id AS CHAR) LIKE :q
      )`,
      { q: `%${q}%` },
    );
  }

  // total
  const totalRow = await qb
    .clone()
    .select('COUNT(ii.id)', 'cnt')
    .getRawOne<{ cnt: string }>();

  const total = Number(totalRow?.cnt ?? 0);

  // data
  const rows = await qb
    .clone()
    .select([
      'ii.id AS invoiceItemId',
      'inv.id AS invoiceId',
      'inv.invoiceNumber AS invoiceNumber',
      'inv.date AS invoiceDate',
      'cust.customerName AS customerName',

      'item.id AS itemId',
      'item.itemName AS itemName',
      'item.type AS itemType',
      'item.stockMode AS stockMode',

      'v.id AS itemVariantId',
      'v.origin AS origin',
      'th.thickness AS thickness',

      'ii.length AS snapLength',
      'ii.width AS snapWidth',
      'ii.sheetsPerBox AS snapSpb',
      'v.length AS origLength',
      'v.width AS origWidth',
      'v.sheetsPerBox AS origSpb',

      'ii.sqm AS soldSqm',
      'ii.quantity AS soldQty',
    ])
    .orderBy('inv.date', 'DESC')
    .addOrderBy('inv.id', 'DESC')
    .addOrderBy('ii.id', 'DESC')
    .offset(start)
    .limit(limit)
    .getRawMany<any>();

  const num = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const data = rows.map((r) => {
    const snapLength = num(r.snapLength);
    const snapWidth = num(r.snapWidth);
    const snapSpb = num(r.snapSpb);

    const origLength = num(r.origLength) ?? 0;
    const origWidth = num(r.origWidth) ?? 0;
    const origSpb = num(r.origSpb) ?? 0;

    const changed = {
      length: snapLength != null ? Math.abs(snapLength - origLength) > tolLenWid : false,
      width: snapWidth != null ? Math.abs(snapWidth - origWidth) > tolLenWid : false,
      sheetsPerBox: snapSpb != null ? Math.abs(snapSpb - origSpb) > tolSpb : false,
    };

    return {
      invoiceItemId: Number(r.invoiceItemId),
      invoiceId: Number(r.invoiceId),
      invoiceNumber: r.invoiceNumber ?? null,
      invoiceDate: r.invoiceDate ?? null,
      customerName: r.customerName ?? null,

      itemName: r.itemName ?? null,
      itemType: String(r.itemType ?? '').toLowerCase(),
      stockMode: String(r.stockMode ?? '').toUpperCase(),

      itemVariantId: Number(r.itemVariantId),
      origin: r.origin ?? null,
      thickness: num(r.thickness),

      sold: {
        sqm: num(r.soldSqm),
        quantity: num(r.soldQty),
      },

      snapshotDims: { length: snapLength, width: snapWidth, sheetsPerBox: snapSpb },
      originalDims: { length: origLength, width: origWidth, sheetsPerBox: origSpb },
      changed,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
    data,
  };
}

}
