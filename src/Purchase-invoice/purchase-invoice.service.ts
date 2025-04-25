import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoice } from '../entities/Purchase-Invoice/purchase-invoice.entity';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepo: Repository<PurchaseInvoice>,
  ) {}

  async create(data: Partial<PurchaseInvoice>) {
    const invoice = this.invoiceRepo.create(data);
    return this.invoiceRepo.save(invoice);
  }

  async findAll() {
    return this.invoiceRepo.find({
      relations: ['supplier', 'items', 'items.itemVariant', 'unitPriceRows'],
    });
  }

  async findOne(id: number) {
    return this.invoiceRepo.findOne({
      where: { id },
      relations: ['supplier', 'items', 'items.itemVariant', 'unitPriceRows'],
    });
  }
  async findMinimalInvoices() {
    return this.invoiceRepo.find({
      select: ['invoiceNumber', 'date', 'grandAmount'],
      order: { id: 'DESC' }, 
    });
  }
}
