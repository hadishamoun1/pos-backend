import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptVoucherService } from './receipt-voucher.service';

describe('ReceiptVoucherService', () => {
  let service: ReceiptVoucherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReceiptVoucherService],
    }).compile();

    service = module.get<ReceiptVoucherService>(ReceiptVoucherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
