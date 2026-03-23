import { Injectable, NotFoundException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentVoucher, PaymentType, VoucherType } from '../entities/Vouchers/paymentVoucher.entity';
import { PaymentVoucherDetail } from '../entities/Vouchers/paymentVoucherDetails.entity';
import { Supplier } from '../entities/supplier.entity';

@Injectable()
export class PaymentVoucherService {
  constructor(
    @InjectRepository(PaymentVoucher)
    private readonly paymentVoucherRepository: Repository<PaymentVoucher>,

    @InjectRepository(PaymentVoucherDetail)
    private readonly paymentVoucherDetailRepository: Repository<PaymentVoucherDetail>,

    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,

    private readonly settingsService: SettingsService,
  ) {}

  private dateOrNull(value: any): string | null {
    if (!value || value === '') return null;
    return value;
  }

  private buildDetail(d: any): PaymentVoucherDetail {
    const exchangeRate = parseFloat(d.exchangeRate) || 1;
    const amount = parseFloat(d.amount) || 0;
    const amountExchanged =
      d.currency === 'USD' ? amount * exchangeRate : amount / exchangeRate;

    return this.paymentVoucherDetailRepository.create({
      amount,
      currency: d.currency,
      exchangeRate,
      amountExchanged,
      checkNumber: d.checkNumber || null,
      checkDate: this.dateOrNull(d.checkDate),
      checkDueDate: this.dateOrNull(d.checkDueDate),
      bankName: d.bankName || null,
      description: d.description || null,
    });
  }

  private async getNextPaymentNumber(type: VoucherType): Promise<string> {
    const activeYear = await this.settingsService.getActiveYear();
    const year = activeYear.slice(-2);
    const prefix = type === 'S' ? `PM${year}-` : `PMG${year}-`;

    const latest = await this.paymentVoucherRepository
      .createQueryBuilder('pv')
      .where('pv.type = :type', { type })
      .andWhere('pv.paymentNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('pv.paymentNumber', 'DESC')
      .take(1)
      .getOne();

    const next =
      latest?.paymentNumber
        ? parseInt(latest.paymentNumber.split('-')[1], 10) + 1
        : 1;

    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private formatVoucher(voucher: PaymentVoucher): any {
    return {
      id: voucher.id,
      supplierId: voucher.supplierId,
      supplierName: voucher.supplier?.supplierName ?? null,
      date: voucher.date,
      invoiceId: voucher.invoiceId,
      paymentType: voucher.paymentType,
      type: voucher.type,
      doneBy: voucher.doneBy,
      paymentNumber: voucher.paymentNumber,
      dateCreated: voucher.dateCreated,
      dateModified: voucher.dateModified,
      details: (voucher.details ?? []).map((d) => ({
        amount: d.amount,
        currency: d.currency,
        exchangeRate: d.exchangeRate,
        amountExchanged: d.amountExchanged,
        checkNumber: d.checkNumber ?? null,
        checkDate: d.checkDate ?? null,
        checkDueDate: d.checkDueDate ?? null,
        bankName: d.bankName ?? null,
        description: d.description ?? null,
      })),
    };
  }

  async getFormatted(): Promise<any[]> {
    const vouchers = await this.paymentVoucherRepository.find({
      relations: ['supplier', 'details'],
    });
    return vouchers.map((v) => this.formatVoucher(v));
  }

  async getFiltered(
    filters: {
      supplierId?: number;
      date?: string;
      paymentType?: string;
      paymentNumber?: string;
      amount?: number;
      type?: string;
    },
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const qb = this.paymentVoucherRepository
      .createQueryBuilder('voucher')
      .leftJoinAndSelect('voucher.supplier', 'supplier')
      .leftJoinAndSelect('voucher.details', 'detail');

    if (filters.supplierId)
      qb.andWhere('voucher.supplierId = :supplierId', { supplierId: filters.supplierId });
    if (filters.date)
      qb.andWhere('DATE(voucher.date) = :date', { date: filters.date });
    if (filters.paymentType)
      qb.andWhere('voucher.paymentType = :paymentType', { paymentType: filters.paymentType });
    if (filters.paymentNumber)
      qb.andWhere('voucher.paymentNumber LIKE :paymentNumber', { paymentNumber: `%${filters.paymentNumber}%` });
    if (filters.amount)
      qb.andWhere('detail.amount = :amount', { amount: filters.amount });
    if (filters.type)
      qb.andWhere('voucher.type = :type', { type: filters.type });

    const total = await qb.getCount();
    const data = await qb.skip((page - 1) * limit).take(limit).getMany();

    return { data: data.map((v) => this.formatVoucher(v)), total, page, limit };
  }

  async createBulk(
    transactions: {
      supplierId: number;
      date: string;
      invoiceId: string;
      paymentType: PaymentType;
      type: VoucherType;
      doneBy: string;
      details: any[];
    }[],
  ): Promise<PaymentVoucher[]> {
    const results: PaymentVoucher[] = [];

    for (const tx of transactions) {
      const supplier = await this.supplierRepository.findOne({ where: { id: tx.supplierId } });
      if (!supplier)
        throw new NotFoundException(`Supplier with ID ${tx.supplierId} not found.`);

      const paymentNumber = await this.getNextPaymentNumber(tx.type);

      const voucher = this.paymentVoucherRepository.create({
        supplier,
        supplierId: supplier.id,
        date: tx.date,
        paymentNumber,
        invoiceId: tx.invoiceId,
        paymentType: tx.paymentType,
        type: tx.type,
        doneBy: tx.doneBy,
        details: tx.details.map((d) => this.buildDetail(d)),
      });

      results.push(await this.paymentVoucherRepository.save(voucher));
    }

    return results;
  }

  async update(
    id: number,
    updateData: {
      supplierId?: number;
      date?: string;
      invoiceId?: string;
      paymentType?: PaymentType;
      type?: VoucherType;
      doneBy?: string;
      details?: any[];
    },
  ): Promise<PaymentVoucher> {
    const voucher = await this.paymentVoucherRepository.findOne({
      where: { id },
      relations: ['supplier', 'details'],
    });
    if (!voucher)
      throw new NotFoundException(`Payment voucher with ID ${id} not found.`);

    if (updateData.supplierId) {
      const supplier = await this.supplierRepository.findOne({ where: { id: updateData.supplierId } });
      if (!supplier)
        throw new NotFoundException(`Supplier with ID ${updateData.supplierId} not found.`);
      voucher.supplier = supplier;
      voucher.supplierId = supplier.id;
    }

    if (updateData.date) voucher.date = updateData.date;
    if (updateData.invoiceId) voucher.invoiceId = updateData.invoiceId;
    if (updateData.paymentType) voucher.paymentType = updateData.paymentType;
    if (updateData.type) voucher.type = updateData.type;
    if (updateData.doneBy) voucher.doneBy = updateData.doneBy;

    if (updateData.details) {
      await this.paymentVoucherDetailRepository.remove(voucher.details);
      voucher.details = updateData.details.map((d) => this.buildDetail(d));
    }

    return this.paymentVoucherRepository.save(voucher);
  }

  async remove(id: number): Promise<void> {
    const voucher = await this.paymentVoucherRepository.findOne({
      where: { id },
      relations: ['details'],
    });
    if (!voucher)
      throw new NotFoundException(`Payment voucher with ID ${id} not found.`);

    await this.paymentVoucherDetailRepository.remove(voucher.details);
    await this.paymentVoucherRepository.delete(id);
  }
}