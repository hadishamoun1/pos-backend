// src/transfers/transfers.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, IsNull } from 'typeorm';
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

    private readonly inventoryTransactionService: InventoryTransactionService,
    private readonly inventoryTransactionGateway: InventoryTransactionGateway,
  ) {}

  async create(data: any): Promise<Transfer> {
    let savedTransfer: Transfer;
    await this.transfersRepo.manager.transaction(
      async (manager: EntityManager) => {
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
            const fromBatch = ti.itemBatch; // Box batch
            const fromVariant = fromBatch.itemVariant;
            const parentItem = fromVariant.thickness.item;

            if (parentItem.type !== 'box') {
              throw new BadRequestException(
                `JF transfers only accept box-type items. Found ${parentItem.itemName} (${parentItem.type})`,
              );
            }

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

            // ✅ InventoryTransaction: Box → Out (sqm only)
            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: fromVariant.id,
              itemBatchId: fromBatch.id,
              transactionType: 'MovedFrom',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txOut);

            // ✅ InventoryTransaction: Sheet → In (sqm only)
            const txIn = manager.getRepository(InventoryTransaction).create({
              itemVariantId: sheetVariant.id,
              itemBatchId: toBatch.id,
              transactionType: 'MovedTo',
              quantity: 0,
              quantityofr: ti.quantity,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txIn);

            // ✅ Update FROM (box) batch
            fromBatch.outOFR = Number(fromBatch.outOFR || 0) + ti.sqm;
            fromBatch.balanceOFR =
              Number(fromBatch.startOFR || 0) +
              Number(fromBatch.inOFR || 0) -
              Number(fromBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(fromBatch);

            // ✅ Update TO (sheet) batch
            toBatch.inOFR = Number(toBatch.inOFR || 0) + ti.sqm;
            toBatch.balanceOFR =
              Number(toBatch.startOFR || 0) +
              Number(toBatch.inOFR || 0) -
              Number(toBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(toBatch);

            // ✅ Update FROM (box) Variant Totals
            fromVariant.totalOutOFR =
              Number(fromVariant.totalOutOFR || 0) + ti.sqm;
            fromVariant.totalBalanceOFR =
              Number(fromVariant.totalStartOFR || 0) +
              Number(fromVariant.totalInOFR || 0) -
              Number(fromVariant.totalOutOFR || 0);

            // ✅ Update TO (sheet) Variant Totals
            sheetVariant.totalInOFR =
              Number(sheetVariant.totalInOFR || 0) + ti.sqm;
            sheetVariant.totalBalanceOFR =
              Number(sheetVariant.totalStartOFR || 0) +
              Number(sheetVariant.totalInOFR || 0) -
              Number(sheetVariant.totalOutOFR || 0);

            await manager
              .getRepository(ItemVariant)
              .save([fromVariant, sheetVariant]);
          }
        }

        //
        if (data.location === 'FJ') {
          for (const ti of persisted) {
            const fromBatch = ti.itemBatch; // Sheet batch
            const fromVariant = fromBatch.itemVariant;
            const parentItem = fromVariant.thickness.item;

            if (parentItem.type !== 'sheet') {
              throw new BadRequestException(
                `FJ transfers only accept sheet-type items. Found ${parentItem.itemName} (${parentItem.type})`,
              );
            }

            const boxThickness = await manager
              .getRepository(Thickness)
              .createQueryBuilder('th')
              .innerJoin(
                'th.item',
                'it',
                'it.itemName = :name AND it.type = :type',
                {
                  name: parentItem.itemName,
                  type: 'box',
                },
              )
              .where('th.thickness = :thick', {
                thick: fromVariant.thickness.thickness,
              })
              .getOne();

            if (!boxThickness) {
              throw new NotFoundException(
                `No box-type thickness ${fromVariant.thickness.thickness} for ${parentItem.itemName}`,
              );
            }

            const boxVariant = await manager
              .getRepository(ItemVariant)
              .findOne({
                where: {
                  thickness: { id: boxThickness.id } as any,
                  origin: fromVariant.origin,
                  length: fromVariant.length,
                  width: fromVariant.width,
                },
              });

            if (!boxVariant) {
              throw new NotFoundException(
                `No box variant for ${parentItem.itemName} at ${fromVariant.length}×${fromVariant.width} origin=${fromVariant.origin}`,
              );
            }

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

            // ✅ Create InventoryTransaction: Sheets → Out (sqm only)
            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: fromVariant.id,
              itemBatchId: fromBatch.id,
              transactionType: 'MovedFrom',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txOut);

            // ✅ Create InventoryTransaction: Box → In (sqm only)
            const txIn = manager.getRepository(InventoryTransaction).create({
              itemVariantId: boxVariant.id,
              itemBatchId: toBatch.id,
              transactionType: 'MovedTo',
              quantity: 0,
              quantityofr: ti.quantity,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txIn);

            // ✅ Update FROM (sheet) batch
            fromBatch.outOFR = Number(fromBatch.outOFR || 0) + ti.sqm;
            fromBatch.balanceOFR =
              Number(fromBatch.startOFR || 0) +
              Number(fromBatch.inOFR || 0) -
              Number(fromBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(fromBatch);

            // ✅ Update TO (box) batch
            toBatch.inOFR = Number(toBatch.inOFR || 0) + ti.sqm;
            toBatch.balanceOFR =
              Number(toBatch.startOFR || 0) +
              Number(toBatch.inOFR || 0) -
              Number(toBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(toBatch);

            // ✅ Update FROM (sheet) Variant Totals
            fromVariant.totalOutOFR =
              Number(fromVariant.totalOutOFR || 0) + ti.sqm;
            fromVariant.totalBalanceOFR =
              Number(fromVariant.totalStartOFR || 0) +
              Number(fromVariant.totalInOFR || 0) -
              Number(fromVariant.totalOutOFR || 0);

            // ✅ Update TO (box) Variant Totals
            boxVariant.totalInOFR = Number(boxVariant.totalInOFR || 0) + ti.sqm;
            boxVariant.totalBalanceOFR =
              Number(boxVariant.totalStartOFR || 0) +
              Number(boxVariant.totalInOFR || 0) -
              Number(boxVariant.totalOutOFR || 0);

            await manager
              .getRepository(ItemVariant)
              .save([fromVariant, boxVariant]);
          }
        }

        //
        // 9) SL: “(box or sheet) → sqm”
        //
        if (data.location === 'SL') {
          for (const ti of persisted) {
            const fromBatch = ti.itemBatch;
            const fromVariant = fromBatch.itemVariant;
            const parentItem = fromVariant.thickness.item;

            // ✅ Skip if not box or sheet
            if (parentItem.type !== 'box' && parentItem.type !== 'sheet')
              continue;

            // ✅ Calculate sheet area
            const lengthM = Number(fromVariant.length) / 100;
            const widthM = Number(fromVariant.width) / 100;
            const sheetArea = lengthM * widthM;

            let totalSqm = 0;
            if (parentItem.type === 'box') {
              totalSqm = ti.quantity * fromVariant.sheetsPerBox * sheetArea;
            } else if (parentItem.type === 'sheet') {
              totalSqm = ti.quantity * sheetArea;
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

            const sqmVariant = await manager
              .getRepository(ItemVariant)
              .findOne({
                where: {
                  thickness: { id: sqmThickness.id } as any,
                  origin: fromVariant.origin,
                },
              });

            if (!sqmVariant) {
              throw new NotFoundException(
                `No sqm variant for ${parentItem.itemName}, thickness=${fromVariant.thickness.thickness}, origin=${fromVariant.origin}`,
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
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -totalSqm,
              finalcost: 0,
              finalcostofr: 0,
            });
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
            });
            await manager.getRepository(InventoryTransaction).save(txIn);

            //
            // ✅ Update FROM Batch (box or sheet)
            //
            fromBatch.outOFR = Number(fromBatch.outOFR || 0) + totalSqm;
            fromBatch.balanceOFR =
              Number(fromBatch.startOFR || 0) +
              Number(fromBatch.inOFR || 0) -
              Number(fromBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(fromBatch);

            //
            // ✅ Update TO Batch (sqm)
            //
            toBatch.inOFR = Number(toBatch.inOFR || 0) + totalSqm;
            toBatch.balanceOFR =
              Number(toBatch.startOFR || 0) +
              Number(toBatch.inOFR || 0) -
              Number(toBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(toBatch);

            //
            // ✅ Update FROM Variant (box/sheet) Totals
            //
            fromVariant.totalOutOFR =
              Number(fromVariant.totalOutOFR || 0) + totalSqm;
            fromVariant.totalBalanceOFR =
              Number(fromVariant.totalStartOFR || 0) +
              Number(fromVariant.totalInOFR || 0) -
              Number(fromVariant.totalOutOFR || 0);

            //
            // ✅ Update TO Variant (sqm) Totals
            //
            sqmVariant.totalInOFR =
              Number(sqmVariant.totalInOFR || 0) + totalSqm;
            sqmVariant.totalBalanceOFR =
              Number(sqmVariant.totalStartOFR || 0) +
              Number(sqmVariant.totalInOFR || 0) -
              Number(sqmVariant.totalOutOFR || 0);

            await manager
              .getRepository(ItemVariant)
              .save([fromVariant, sqmVariant]);
          }
        }

        //
        if (data.location === 'LS') {
          for (const ti of persisted) {
            const toBatch = ti.itemBatch;
            const destVariant = toBatch.itemVariant;
            const parentItem = destVariant.thickness.item;

            if (parentItem.type !== 'box' && parentItem.type !== 'sheet') {
              continue;
            }

            //
            // ✅ Step 1: Find original SQM variant (same itemName, thickness, origin)
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

            const sqmVariant = await manager
              .getRepository(ItemVariant)
              .findOne({
                where: {
                  thickness: { id: sqmThickness.id } as any,
                  origin: destVariant.origin,
                },
              });

            if (!sqmVariant) {
              throw new NotFoundException(
                `No sqm variant for ${parentItem.itemName}, thickness=${destVariant.thickness.thickness}, origin=${destVariant.origin}`,
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
              quantityofr: -ti.sqm,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txOut);

            //
            // ✅ Step 4: Create InventoryTransaction → Credit box/sheet batch
            //
            const txIn = manager.getRepository(InventoryTransaction).create({
              itemVariantId: destVariant.id,
              itemBatchId: toBatch.id,
              transactionType: 'MovedTo',
              quantity: 0,
              quantityofr: ti.quantity,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txIn);

            //
            // ✅ Step 5: Update FROM batch (sqm)
            //
            fromBatch.outOFR = Number(fromBatch.outOFR || 0) + ti.sqm;
            fromBatch.balanceOFR =
              Number(fromBatch.startOFR || 0) +
              Number(fromBatch.inOFR || 0) -
              Number(fromBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(fromBatch);

            //
            // ✅ Step 6: Update TO batch (box/sheet)
            //
            toBatch.inOFR = Number(toBatch.inOFR || 0) + ti.sqm;
            toBatch.balanceOFR =
              Number(toBatch.startOFR || 0) +
              Number(toBatch.inOFR || 0) -
              Number(toBatch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(toBatch);

            //
            // ✅ Step 7: Update FROM variant (sqm)
            //
            sqmVariant.totalOutOFR =
              Number(sqmVariant.totalOutOFR || 0) + ti.sqm;
            sqmVariant.totalBalanceOFR =
              Number(sqmVariant.totalStartOFR || 0) +
              Number(sqmVariant.totalInOFR || 0) -
              Number(sqmVariant.totalOutOFR || 0);

            //
            // ✅ Step 8: Update TO variant (box/sheet)
            //
            destVariant.totalInOFR =
              Number(destVariant.totalInOFR || 0) + ti.sqm;
            destVariant.totalBalanceOFR =
              Number(destVariant.totalStartOFR || 0) +
              Number(destVariant.totalInOFR || 0) -
              Number(destVariant.totalOutOFR || 0);

            await manager
              .getRepository(ItemVariant)
              .save([sqmVariant, destVariant]);
          }
        }

        // 7) BR: “Breakage” → Deduct quantity and sqm from inventory
        //
        // 7) Breakage → Deduct sqmOFR from batch and variant
        if (data.location === 'Breakage') {
          for (const ti of persisted) {
            const batch = ti.itemBatch;
            const variant = batch.itemVariant;

            // Create InventoryTransaction
            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: variant.id,
              itemBatchId: batch.id,
              transactionType: 'Breakage',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txOut);

            // Update Batch
            batch.outOFR = Number(batch.outOFR || 0) + ti.sqm;
            batch.balanceOFR =
              Number(batch.startOFR || 0) +
              Number(batch.inOFR || 0) -
              Number(batch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(batch);

            // Update Variant Totals
            variant.totalOutOFR = Number(variant.totalOutOFR || 0) + ti.sqm;
            variant.totalBalanceOFR =
              Number(variant.totalStartOFR || 0) +
              Number(variant.totalInOFR || 0) -
              Number(variant.totalOutOFR || 0);
            await manager.getRepository(ItemVariant).save(variant);
          }
        }

        // 8) Adjustment + → Add sqmOFR to batch and variant
        if (data.location === 'Adjustment +') {
          for (const ti of persisted) {
            const batch = ti.itemBatch;
            const variant = batch.itemVariant;

            const txIn = manager.getRepository(InventoryTransaction).create({
              itemVariantId: variant.id,
              itemBatchId: batch.id,
              transactionType: 'Adjustment +',
              quantity: 0,
              quantityofr: ti.quantity,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txIn);

            // Update Batch
            batch.inOFR = Number(batch.inOFR || 0) + ti.sqm;
            batch.balanceOFR =
              Number(batch.startOFR || 0) +
              Number(batch.inOFR || 0) -
              Number(batch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(batch);

            // Update Variant Totals
            variant.totalInOFR = Number(variant.totalInOFR || 0) + ti.sqm;
            variant.totalBalanceOFR =
              Number(variant.totalStartOFR || 0) +
              Number(variant.totalInOFR || 0) -
              Number(variant.totalOutOFR || 0);
            await manager.getRepository(ItemVariant).save(variant);
          }
        }

        // 9) Adjustment - → Subtract sqmOFR from batch and variant
        if (data.location === 'Adjustment -') {
          for (const ti of persisted) {
            const batch = ti.itemBatch;
            const variant = batch.itemVariant;

            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: variant.id,
              itemBatchId: batch.id,
              transactionType: 'Adjustment -',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txOut);

            // Update Batch
            batch.outOFR = Number(batch.outOFR || 0) + ti.sqm;
            batch.balanceOFR =
              Number(batch.startOFR || 0) +
              Number(batch.inOFR || 0) -
              Number(batch.outOFR || 0);
            await manager.getRepository(ItemBatch).save(batch);

            // Update Variant Totals
            variant.totalOutOFR = Number(variant.totalOutOFR || 0) + ti.sqm;
            variant.totalBalanceOFR =
              Number(variant.totalStartOFR || 0) +
              Number(variant.totalInOFR || 0) -
              Number(variant.totalOutOFR || 0);
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
}
