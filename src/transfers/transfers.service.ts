// src/transfers/transfers.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { Settings } from '../entities/settings.entity';
import { InventoryTransaction } from '../entities/inventory/inventoryTransactions.entity';
import { Thickness } from '../entities/inventory/thickness.entity';
import { ItemVariant } from '../entities/inventory/itemVariant.entity';
import { Item } from 'src/entities/inventory/item.entity';

import { InventoryTransactionGateway } from '../inventroy-transactions/inventory-transaction.gateway';
import { InventoryTransactionService } from '../inventroy-transactions/inventroy-transactions.service';

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
              itemVariantId: i.itemVariantId,
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
            'itemVariant',
            'itemVariant.thickness',
            'itemVariant.thickness.item',
          ],
        });

        //
        // 7) JF: “box → sheet” logic (throws if any non-“box” found)
        //
        if (data.location === 'JF') {
          for (const ti of persisted) {
            const boxVariant = ti.itemVariant;
            const parentItem = boxVariant.thickness.item;

            // 7a) reject if not box
            if (parentItem.type !== 'box') {
              const thValue = boxVariant.thickness.thickness;
              throw new BadRequestException(
                `JF transfers only accept box‐type items. ` +
                  `"${parentItem.itemName} ملم ${thValue}" is type "${parentItem.type}".`,
              );
            }

            // 7b) Deduct the boxes
            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: boxVariant.id,
              transactionType: 'MovedFrom',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txOut);

            // 7c) Find sheet‐type thickness
            const sheetThickness = await manager
              .getRepository(Thickness)
              .createQueryBuilder('th')
              .innerJoin(
                'th.item',
                'it',
                'it.itemName = :nm AND it.type = :tp',
                { nm: parentItem.itemName, tp: 'sheet' },
              )
              .where('th.thickness = :val', {
                val: boxVariant.thickness.thickness,
              })
              .getOne();

            if (!sheetThickness) {
              throw new NotFoundException(
                `No sheet‐type thickness ${boxVariant.thickness.thickness} ` +
                  `for "${parentItem.itemName}"`,
              );
            }

            // 7d) Find exact sheet variant (origin + length + width)
            const sheetVariant = await manager
              .getRepository(ItemVariant)
              .findOne({
                where: {
                  thickness: { id: sheetThickness.id } as any,
                  origin: boxVariant.origin,
                  length: boxVariant.length,
                  width: boxVariant.width,
                },
              });

            if (!sheetVariant) {
              throw new NotFoundException(
                `No sheet variant for "${parentItem.itemName}" ` +
                  `@ ${boxVariant.length}×${boxVariant.width} origin=${boxVariant.origin}`,
              );
            }

            // 7e) Credit sheets = boxes × sheetsPerBox
            const sheetCount = ti.quantity * boxVariant.sheetsPerBox;
            const txIn = manager.getRepository(InventoryTransaction).create({
              itemVariantId: sheetVariant.id,
              transactionType: 'MovedTo',
              quantity: 0,
              quantityofr: sheetCount,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txIn);
          }
        }

        //
        // 8) FJ: “sheet → box” logic (now throws if any non-“sheet” found)
        //
        if (data.location === 'FJ') {
          for (const ti of persisted) {
            const sheetVariant = ti.itemVariant;
            const parentItem = sheetVariant.thickness.item;

            // 8a) Reject if not a sheet under FJ
            if (parentItem.type !== 'sheet') {
              const thValue = sheetVariant.thickness.thickness;
              throw new BadRequestException(
                `FJ transfers only accept sheet‐type items. ` +
                  `"${parentItem.itemName} ملم ${thValue}" is type "${parentItem.type}".`,
              );
            }

            // 8b) Remove the sheets
            const txOutSheet = manager
              .getRepository(InventoryTransaction)
              .create({
                itemVariantId: sheetVariant.id,
                transactionType: 'MovedFrom',
                quantity: 0,
                quantityofr: -ti.quantity,
                sqm: 0,
                sqmofr: -ti.sqm,
                finalcost: 0,
                finalcostofr: 0,
              });
            await manager.getRepository(InventoryTransaction).save(txOutSheet);

            // 8c) Find “box” thickness matching same itemName + thickness
            const boxThickness = await manager
              .getRepository(Thickness)
              .createQueryBuilder('th')
              .innerJoin(
                'th.item',
                'it',
                'it.itemName = :nm AND it.type = :tp',
                { nm: parentItem.itemName, tp: 'box' },
              )
              .where('th.thickness = :val', {
                val: sheetVariant.thickness.thickness,
              })
              .getOne();

            if (!boxThickness) {
              throw new NotFoundException(
                `No box‐type thickness ${sheetVariant.thickness.thickness} ` +
                  `for "${parentItem.itemName}"`,
              );
            }

            // 8d) Find the exact box variant by origin + dimensions
            const boxVariant = await manager
              .getRepository(ItemVariant)
              .findOne({
                where: {
                  thickness: { id: boxThickness.id } as any,
                  origin: sheetVariant.origin,
                  length: sheetVariant.length,
                  width: sheetVariant.width,
                },
              });

            if (!boxVariant) {
              throw new NotFoundException(
                `No box variant for "${parentItem.itemName}" ` +
                  `@ ${sheetVariant.length}×${sheetVariant.width} origin=${sheetVariant.origin}`,
              );
            }

            // 8e) Credit boxes = sheets ÷ sheetsPerBox (must divide evenly)
            const perBox = boxVariant.sheetsPerBox;
            if (perBox <= 0) {
              throw new NotFoundException(
                `Invalid sheetsPerBox for box variant id=${boxVariant.id}`,
              );
            }
            if (ti.quantity % perBox !== 0) {
              throw new NotFoundException(
                `Sheet quantity ${ti.quantity} is not a multiple of ${perBox} ` +
                  `for "${parentItem.itemName}"`,
              );
            }
            const boxCount = ti.quantity / perBox;
            const txInBox = manager.getRepository(InventoryTransaction).create({
              itemVariantId: boxVariant.id,
              transactionType: 'MovedTo',
              quantity: 0,
              quantityofr: boxCount,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txInBox);
          }
        }

        //
        // 9) SL: “(box or sheet) → sqm”
        //
        if (data.location === 'SL') {
          for (const ti of persisted) {
            const variant = ti.itemVariant;
            const parentItem = variant.thickness.item;
            if (parentItem.type !== 'box' && parentItem.type !== 'sheet') {
              continue;
            }

            // 9a) Remove original units (boxes or sheets)
            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: variant.id,
              transactionType: 'MovedFrom',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txOut);

            // 9b) Compute sheetArea and totalSqm
            const lengthCm = parseFloat(variant.length.toString());
            const widthCm = parseFloat(variant.width.toString());
            const sheetArea = (lengthCm / 100) * (widthCm / 100);
            let totalSqm: number;
            if (parentItem.type === 'box') {
              totalSqm = ti.quantity * variant.sheetsPerBox * sheetArea;
            } else {
              totalSqm = ti.quantity * sheetArea;
            }

            // 9c) Find “sqm” variant (same itemName + thickness + origin)
            const sqmThickness = await manager
              .getRepository(Thickness)
              .createQueryBuilder('th')
              .innerJoin(
                'th.item',
                'it',
                'it.itemName = :nm AND it.type = :tp',
                { nm: parentItem.itemName, tp: 'sqm' },
              )
              .where('th.thickness = :val', {
                val: variant.thickness.thickness,
              })
              .getOne();

            if (!sqmThickness) {
              throw new NotFoundException(
                `No “sqm”‐type thickness ${variant.thickness.thickness} ` +
                  `for "${parentItem.itemName}"`,
              );
            }

            const sqmVariant = await manager
              .getRepository(ItemVariant)
              .findOne({
                where: {
                  thickness: { id: sqmThickness.id } as any,
                  origin: variant.origin,
                },
              });

            if (!sqmVariant) {
              throw new NotFoundException(
                `No “sqm” variant for "${parentItem.itemName}", ` +
                  `thickness=${variant.thickness.thickness}, origin=${variant.origin}`,
              );
            }

            // 9d) Credit the computed sqm
            const txIn = manager.getRepository(InventoryTransaction).create({
              itemVariantId: sqmVariant.id,
              transactionType: 'MovedTo',
              quantity: 0,
              quantityofr: totalSqm,
              sqm: 0,
              sqmofr: totalSqm,
              finalcost: 0,
              finalcostofr: 0,
            });
            await manager.getRepository(InventoryTransaction).save(txIn);
          }
        }

        //
        // 10) LS: “ sqm → (box or sheet) ”
        //
        if (data.location === 'LS') {
          for (const ti of persisted) {
            const destVariant = ti.itemVariant;
            const parentItem = destVariant.thickness.item;
            if (parentItem.type !== 'box' && parentItem.type !== 'sheet') {
              continue;
            }

            // 10a) Remove the SQM from its “sqm” variant
            const originalSqmThickness = await manager
              .getRepository(Thickness)
              .createQueryBuilder('th')
              .innerJoin(
                'th.item',
                'it',
                'it.itemName = :nm AND it.type = :tp',
                { nm: parentItem.itemName, tp: 'sqm' },
              )
              .where('th.thickness = :val', {
                val: destVariant.thickness.thickness,
              })
              .getOne();

            if (!originalSqmThickness) {
              throw new NotFoundException(
                `No “sqm”‐type thickness ${destVariant.thickness.thickness} ` +
                  `for "${parentItem.itemName}"`,
              );
            }

            const originalSqmVariant = await manager
              .getRepository(ItemVariant)
              .findOne({
                where: {
                  thickness: { id: originalSqmThickness.id } as any,
                  origin: destVariant.origin,
                },
              });

            if (!originalSqmVariant) {
              throw new NotFoundException(
                `No “sqm” variant for "${parentItem.itemName}", ` +
                  `thickness=${destVariant.thickness.thickness}, origin=${destVariant.origin}`,
              );
            }

            // 10b) Deduct that many sqm
            const txOutSqm = manager
              .getRepository(InventoryTransaction)
              .create({
                itemVariantId: originalSqmVariant.id,
                transactionType: 'MovedFrom',
                quantity: 0,
                quantityofr: -ti.sqm,
                sqm: 0,
                sqmofr: -ti.sqm,
                finalcost: 0,
                finalcostofr: 0,
              });
            await manager.getRepository(InventoryTransaction).save(txOutSqm);

            // 10c) Credit the destination (box or sheet) with its own unit count
            const txInDest = manager
              .getRepository(InventoryTransaction)
              .create({
                itemVariantId: destVariant.id,
                transactionType: 'MovedTo',
                quantity: 0,
                quantityofr: ti.quantity,
                sqm: 0,
                sqmofr: ti.sqm,
                finalcost: 0,
                finalcostofr: 0,
              });
            await manager.getRepository(InventoryTransaction).save(txInDest);
          }
        }
        // 7) BR: “Breakage” → Deduct quantity and sqm from inventory
        //
        if (data.location === 'Breakage') {
          for (const ti of persisted) {
            const variant = ti.itemVariant;

            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: variant.id,
              transactionType: 'Breakage',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });

            await manager.getRepository(InventoryTransaction).save(txOut);
          }
        }
        // 8) Adjustment +: Add quantity and sqm to inventory
        //
        if (data.location === 'Adjustment +') {
          for (const ti of persisted) {
            const variant = ti.itemVariant;

            const txIn = manager.getRepository(InventoryTransaction).create({
              itemVariantId: variant.id,
              transactionType: 'Adjustment +',
              quantity: 0,
              quantityofr: ti.quantity,
              sqm: 0,
              sqmofr: ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });

            await manager.getRepository(InventoryTransaction).save(txIn);
          }
        }
        // 9) Adjustment -: Subtract quantity and sqm from inventory
        //
        if (data.location === 'Adjustment -') {
          for (const ti of persisted) {
            const variant = ti.itemVariant;

            const txOut = manager.getRepository(InventoryTransaction).create({
              itemVariantId: variant.id,
              transactionType: 'Adjustment -',
              quantity: 0,
              quantityofr: -ti.quantity,
              sqm: 0,
              sqmofr: -ti.sqm,
              finalcost: 0,
              finalcostofr: 0,
            });

            await manager.getRepository(InventoryTransaction).save(txOut);
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
        'items.itemVariant',
        'items.itemVariant.thickness',
        'items.itemVariant.thickness.item',
      ],
      order: { id: 'DESC' },
    });
  }
}
