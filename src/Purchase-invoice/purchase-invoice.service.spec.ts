import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseInvoiceService } from './purchase-invoice.service';

describe('PurchaseInvoiceService', () => {
  let service: PurchaseInvoiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseInvoiceService],
    }).compile();

    service = module.get<PurchaseInvoiceService>(PurchaseInvoiceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
