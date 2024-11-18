import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoice } from '../entities/purchaseInvoice.entity';
import { PurchaseInvoiceItem } from '../entities/purchaseItem.entity';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';
import { Settings } from '../entities/settings.entity';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseInvoiceItem)
    private readonly purchaseInvoiceItemRepo: Repository<PurchaseInvoiceItem>,
    @InjectRepository(Settings)
    private readonly settingsRepo: Repository<Settings>,
  ) {}

  async create(dto: CreatePurchaseInvoiceDto) {
    const { items, ...invoiceData } = dto;

    // Fetch the active year from settings
    const activeSettings = await this.settingsRepo.findOne({
      where: { isActive: true },
    });

    if (!activeSettings || !activeSettings.year) {
      throw new Error('Active year is not set in settings.');
    }

    const currentYear = activeSettings.year;

    // Generate invoice number
    const prefix = invoiceData.type === 'S' ? 'S' : 'G';
    const lastInvoice = await this.purchaseInvoiceRepo.findOne({
      where: { type: invoiceData.type },
      order: { id: 'DESC' },
    });

    const lastInvoiceNumber = lastInvoice?.invoiceNumber?.split('-')[1] || '0';
    const nextSequence = parseInt(lastInvoiceNumber, 10) + 1;

    const invoiceNumber = `${prefix}${currentYear}-${nextSequence.toString().padStart(4, '0')}`;

    // Create invoice
    const invoice = this.purchaseInvoiceRepo.create({
      ...invoiceData,
      invoiceNumber,
    });
    const savedInvoice = await this.purchaseInvoiceRepo.save(invoice);

    // Create items
    const invoiceItems = items.map((item) => ({
      purchaseInvoice: savedInvoice,
      dimension: { dimensionId: item.dimensionId },
      unitPrice: item.unitPrice,
      totalAmount: item.totalAmount,
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
