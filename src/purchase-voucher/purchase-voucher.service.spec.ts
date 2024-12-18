import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseVoucherService } from './purchase-voucher.service';

describe('PurchaseVoucherService', () => {
  let service: PurchaseVoucherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseVoucherService],
    }).compile();

    service = module.get<PurchaseVoucherService>(PurchaseVoucherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
