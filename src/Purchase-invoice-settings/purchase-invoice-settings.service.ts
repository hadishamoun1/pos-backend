import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoiceSetting } from '../entities/purchaseInvoiceSettings';

@Injectable()
export class PurchaseInvoiceSettingService {
  constructor(
    @InjectRepository(PurchaseInvoiceSetting)
    private readonly settingRepo: Repository<PurchaseInvoiceSetting>,
  ) {}

  findAll() {
    return this.settingRepo.find();
  }

  findOne(id: number) {
    return this.settingRepo.findOne({ where: { id } });
  }

  create(data: Partial<PurchaseInvoiceSetting>) {
    const setting = this.settingRepo.create(data);
    return this.settingRepo.save(setting);
  }

  update(id: number, data: Partial<PurchaseInvoiceSetting>) {
    return this.settingRepo.update(id, data);
  }

  async remove(id: number) {
    const setting = await this.settingRepo.findOne({ where: { id } });
    if (setting) {
      return this.settingRepo.remove(setting);
    }
    return null;
  }
}
