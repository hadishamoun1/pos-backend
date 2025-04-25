import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoiceSetting } from '../entities/purchaseInvoiceSettings';
import { Account } from '../entities/account.entity';
import { Customer } from '../entities/customer.entity';
import { Supplier } from '../entities/supplier.entity';

@Injectable()
export class PurchaseInvoiceSettingService {
  constructor(
    @InjectRepository(PurchaseInvoiceSetting)
    private readonly settingRepo: Repository<PurchaseInvoiceSetting>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,

    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
  ) {}

  findAll() {
    return this.settingRepo.find({
      relations: ['account', 'customer', 'supplier'],
    });
  }

  findOne(id: number) {
    return this.settingRepo.findOne({
      where: { id },
      relations: ['account', 'customer', 'supplier'],
    });
  }

  // In your PurchaseInvoiceSettingService

  async createMany(dataArray: any[]) {
    const results = [];

    for (const data of dataArray) {
      const setting = this.settingRepo.create({
        chargeName: data.chargeName,
        type: data.type,
        atc: data.atc,
        shipping: data.shipping,
        value: data.value || 0,
        valueEx: data.valueEx || 0,
        currency: data.currency,
        exchangeRate: data.exchangeRate || 0,
      });

      if (data.accountNumber.startsWith('4111')) {
        setting.customerId = data.accountId;
      } else if (data.accountNumber.startsWith('4011')) {
        setting.supplierId = data.accountId;
      } else {
        setting.accountId = data.accountId;
      }

      results.push(await this.settingRepo.save(setting));
    }

    return results;
  }
  async create(data: any) {
    const setting = this.settingRepo.create({
      chargeName: data.chargeName,
      type: data.type,
      atc: data.atc,
      shipping: data.shipping,
      value: data.value || 0,
      valueEx: data.valueEx || 0,
      currency: data.currency,
      exchangeRate: data.exchangeRate || 0,
    });

    if (data.accountNumber.startsWith('4111')) {
      setting.customerId = data.accountId;
    } else if (data.accountNumber.startsWith('4011')) {
      setting.supplierId = data.accountId;
    } else {
      setting.accountId = data.accountId;
    }

    return this.settingRepo.save(setting);
  }

  async update(id: number, data: Partial<PurchaseInvoiceSetting>) {
    const setting = await this.settingRepo.findOne({ where: { id } });
    if (!setting) return null;

    Object.assign(setting, data);

    if (data.account && typeof data.account === 'number') {
      setting.account = await this.accountRepo.findOne({
        where: { id: data.account },
      });
    }

    if (data.customer && typeof data.customer === 'number') {
      setting.customer = await this.customerRepo.findOne({
        where: { id: data.customer },
      });
    }

    if (data.supplier && typeof data.supplier === 'number') {
      setting.supplier = await this.supplierRepo.findOne({
        where: { id: data.supplier },
      });
    }

    return this.settingRepo.save(setting);
  }

  async remove(id: number) {
    const setting = await this.settingRepo.findOne({ where: { id } });
    if (setting) {
      return this.settingRepo.remove(setting);
    }
    return null;
  }
}
