import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';
import { PurchaseInvoiceItem } from '../entities/purchaseItem.entity';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseInvoiceItem)
    private readonly purchaseInvoiceItemRepo: Repository<PurchaseInvoiceItem>,
  ) {}

  async create(dto: CreatePurchaseInvoiceDto) {
    const { items, ...invoiceData } = dto;

    // Generate invoice number
    const currentYear = new Date().getFullYear();
    const prefix = invoiceData.type === 'S' ? 'S' : 'G';
    const lastInvoice = await this.purchaseInvoiceRepo.findOne({
      order: { id: 'DESC' },
    });
    const invoiceNumber = `${prefix}${currentYear}-${(lastInvoice?.id || 0) + 1}`;

    // Create invoice
    const invoice = this.purchaseInvoiceRepo.create({
      ...invoiceData,
      invoiceNumber,
    });
    const savedInvoice = await this.purchaseInvoiceRepo.save(invoice);

    // Create items
    const invoiceItems = items.map((item) => ({
      ...item,
      purchaseInvoice: savedInvoice,
    }));
    await this.purchaseInvoiceItemRepo.save(invoiceItems);

    return savedInvoice;
  }

  async findAll() {
    return this.purchaseInvoiceRepo.find({
      relations: ['items', 'items.dimension'],
    });
  }

  async findOne(id: number) {
    return this.purchaseInvoiceRepo.findOne({
      where: { id },
      relations: ['items', 'items.dimension'],
    });
  }

  async update(id: number, updateData: Partial<PurchaseInvoice>) {
    await this.purchaseInvoiceRepo.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: number) {
    await this.purchaseInvoiceRepo.delete(id);
    return { deleted: true };
  }
}
