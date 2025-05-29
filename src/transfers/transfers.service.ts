// src/transfers/transfers.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transfersRepo: Repository<Transfer>,
    @InjectRepository(TransferItem)
    private readonly itemsRepo: Repository<TransferItem>,
  ) {}

  async create(data: any): Promise<Transfer> {
    // build the Transfer
    const transfer = this.transfersRepo.create({
      transferNumber: data.transferNumber,
      date: data.date,
      type: data.type,
      location: data.location,
      items: (data.items || []).map((i: any) =>
        this.itemsRepo.create({
          itemVariantId: i.itemVariantId,
          quantity: i.quantity,
          sqm: i.sqm,
          price: i.price,
        }),
      ),
    });

    return this.transfersRepo.save(transfer);
  }

  async findOne(id: number): Promise<Transfer> {
    const t = await this.transfersRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!t) throw new NotFoundException(`Transfer #${id} not found`);
    return t;
  }

  async findAll(): Promise<Transfer[]> {
    return this.transfersRepo.find({ relations: ['items'] });
  }
}
