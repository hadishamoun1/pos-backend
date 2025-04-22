import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseInvoiceSettingsController } from './purchase-invoice-settings.controller';
import { PurchaseInvoiceSettingsService } from './purchase-invoice-settings.service';

describe('PurchaseInvoiceSettingsController', () => {
  let controller: PurchaseInvoiceSettingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseInvoiceSettingsController],
      providers: [PurchaseInvoiceSettingsService],
    }).compile();

    controller = module.get<PurchaseInvoiceSettingsController>(PurchaseInvoiceSettingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
