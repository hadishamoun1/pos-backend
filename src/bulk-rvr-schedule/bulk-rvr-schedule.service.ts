import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { BulkRvrSchedule } from './bulk-rvr-schedule.entity';
import { InvoiceService } from '../invoice/invoice.service';
import { RecievablesService } from '../receipt-voucher/recievables.service';

@Injectable()
export class BulkRvrScheduleService implements OnModuleInit {
  constructor(
    @InjectRepository(BulkRvrSchedule)
    private readonly repo: Repository<BulkRvrSchedule>,
    private readonly invoiceService: InvoiceService,
    private readonly recievablesService: RecievablesService,
  ) {}

  async onModuleInit() {
    const existing = await this.repo.findOne({ where: { id: 1 } });
    if (!existing) {
      await this.repo.save(this.repo.create({ id: 1, enabled: false }));
    }
  }

  async getConfig(): Promise<BulkRvrSchedule> {
    return this.repo.findOne({ where: { id: 1 } });
  }

  async updateConfig(data: Partial<BulkRvrSchedule>): Promise<BulkRvrSchedule> {
    await this.repo.update(1, data);
    return this.getConfig();
  }

  // Runs at the top of every hour — checks if this is the configured hour and hasn't run today
  @Cron('0 * * * *')
  async scheduledRun() {
    const config = await this.getConfig();
    if (!config?.enabled) return;

    const now = new Date();
    if (now.getUTCHours() !== Number(config.runHour)) return;

    // Check allowed days (0=Sun … 6=Sat). Empty/null means every day.
    if (config.allowedDays) {
      const allowed = config.allowedDays.split(',').map((d) => Number(d.trim())).filter((d) => !isNaN(d));
      if (allowed.length > 0 && !allowed.includes(now.getUTCDay())) return;
    }

    // Check if already ran today (UTC date)
    if (config.lastRunAt) {
      const last = new Date(config.lastRunAt);
      const sameDay =
        last.getUTCFullYear() === now.getUTCFullYear() &&
        last.getUTCMonth() === now.getUTCMonth() &&
        last.getUTCDate() === now.getUTCDate();
      if (sameDay) return;
    }

    await this.executeBatch(config);
  }

  async runNow(): Promise<{ invoicesCreated: number; receivablesCreated: number; errors: string[] }> {
    const config = await this.getConfig();
    return this.executeBatch(config);
  }

  private async executeBatch(
    config: BulkRvrSchedule,
  ): Promise<{ invoicesCreated: number; receivablesCreated: number; errors: string[] }> {
    const qty = Math.max(1, Number(config.quantity) || 1);
    const errors: string[] = [];
    let invoicesCreated = 0;
    let receivablesCreated = 0;

    const today = new Date().toISOString().slice(0, 10);
    const unitPrice = Number(config.invoiceUnitPrice) || 0;
    const vatRate = 0.11;
    const vatAmount = parseFloat((unitPrice * vatRate).toFixed(2));
    const grandTotal = parseFloat((unitPrice + vatAmount).toFixed(2));

    for (let i = 0; i < qty; i++) {
      try {
        await this.invoiceService.createInvoice({
          customerId: config.invoiceCustomerId,
          date: today as any,
          invoiceType: 'RVR',
          documentNumber: 'DOC-0001',
          currencyCode: 'USD',
          totalWithoutVAT: unitPrice,
          totalVAT: vatAmount,
          grandTotal,
          currencyRate: 1,
          vatPercentage: 11,
          items: [
            {
              itemVariantId: config.invoiceItemVariantId,
              itemBatchId: config.invoiceItemBatchId,
              itemType: config.invoiceItemType || 'unit',
              stockMode: config.invoiceItemStockMode || null,
              quantity: 1,
              sqm: 0,
              unitPrice,
              totalAmount: unitPrice,
              vat: vatAmount,
              length: null,
              width: null,
              sheetsPerBox: null,
            },
          ],
        } as any);
        invoicesCreated++;
      } catch (e) {
        errors.push(`Invoice ${i + 1}: ${e?.message || String(e)}`);
      }
    }

    const cashNumber = Number(config.receivableCashAmount) || 0;
    const rate = Number(config.receivableExchangeRate) || 89500;
    const currency = (config.receivableCurrency || 'USD') as 'USD' | 'LL';
    const amountExchanged =
      currency === 'LL'
        ? parseFloat((cashNumber / rate).toFixed(2))
        : parseFloat((cashNumber * rate).toFixed(2));

    for (let i = 0; i < qty; i++) {
      try {
        await this.recievablesService.create({
          customerId: config.receivableCustomerId,
          date: new Date(today),
          invoiceId: null,
          cashNumber,
          currency,
          exchangeRate: rate,
          amountExchanged,
          comments: '',
          type: 'RVR',
          pmtType: 'Cash',
        });
        receivablesCreated++;
      } catch (e) {
        errors.push(`Receivable ${i + 1}: ${e?.message || String(e)}`);
      }
    }

    const result = { invoicesCreated, receivablesCreated, errors };
    await this.repo.update(1, {
      lastRunAt: new Date(),
      lastRunResult: JSON.stringify(result),
    });

    return result;
  }
}
