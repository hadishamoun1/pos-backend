import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseInvoiceSettingsService } from './purchase-invoice-settings.service';

describe('PurchaseInvoiceSettingsService', () => {
  let service: PurchaseInvoiceSettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseInvoiceSettingsService],
    }).compile();

    service = module.get<PurchaseInvoiceSettingsService>(PurchaseInvoiceSettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
