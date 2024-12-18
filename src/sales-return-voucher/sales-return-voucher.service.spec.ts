import { Test, TestingModule } from '@nestjs/testing';
import { SalesReturnVoucherService } from './sales-return-voucher.service';

describe('SalesReturnVoucherService', () => {
  let service: SalesReturnVoucherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesReturnVoucherService],
    }).compile();

    service = module.get<SalesReturnVoucherService>(SalesReturnVoucherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
