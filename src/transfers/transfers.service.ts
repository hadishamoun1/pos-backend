// src/transfers/transfers.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transfer } from '../entities/inventory/transfer.entity';
import { TransferItem } from '../entities/inventory/transferItem.entity';
import { Settings } from '../entities/settings.entity';

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transfersRepo: Repository<Transfer>,

    @InjectRepository(TransferItem)
    private readonly itemsRepo: Repository<TransferItem>,

    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,
  ) {}

  async create(data: any): Promise<Transfer> {
    // 1) fetch the active Settings row to get the year
    const setting = await this.settingsRepo.findOne({
      where: { isActive: true },
    });
    if (!setting) {
      throw new NotFoundException('No active year found in Settings');
    }
    const year2 = setting.year.slice(-2); // e.g. "2025" → "25"

    // 2) choose prefix based *only* on data.location
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

    // 3) find last saved for this prefix+year
    const last = await this.transfersRepo
      .createQueryBuilder('t')
      .where('t.transferNumber LIKE :pattern', {
        pattern: `${prefix}${year2}-%`,
      })
      .orderBy('t.id', 'DESC')
      .getOne();

    // 4) bump the sequence (5 digits)
    let next = 1;
    if (last) {
      const [, num] = last.transferNumber.split('-');
      next = parseInt(num, 10) + 1;
    }
    const seqPadded = String(next).padStart(2, '0');

    // 5) build transferNumber
    const transferNumber = `${prefix}${year2}-${seqPadded}`;

    // 6) assemble & save
    const transfer = this.transfersRepo.create({
      transferNumber,
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

 
}
