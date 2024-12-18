import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseReturnVoucherService } from './purchase-return-voucher.service';

describe('PurchaseReturnVoucherService', () => {
  let service: PurchaseReturnVoucherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseReturnVoucherService],
    }).compile();

    service = module.get<PurchaseReturnVoucherService>(PurchaseReturnVoucherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
