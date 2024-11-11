import { Test, TestingModule } from '@nestjs/testing';
import { PurchasesInvoiceService } from './purchases-invoice.service';

describe('PurchasesInvoiceService', () => {
  let service: PurchasesInvoiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchasesInvoiceService],
    }).compile();

    service = module.get<PurchasesInvoiceService>(PurchasesInvoiceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
