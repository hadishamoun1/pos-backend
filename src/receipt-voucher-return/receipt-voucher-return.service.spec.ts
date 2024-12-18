import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptVoucherReturnService } from './receipt-voucher-return.service';

describe('ReceiptVoucherReturnService', () => {
  let service: ReceiptVoucherReturnService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReceiptVoucherReturnService],
    }).compile();

    service = module.get<ReceiptVoucherReturnService>(ReceiptVoucherReturnService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
