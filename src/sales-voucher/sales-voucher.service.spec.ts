import { Test, TestingModule } from '@nestjs/testing';
import { SalesVoucherService } from './sales-voucher.service';

describe('SalesVoucherService', () => {
  let service: SalesVoucherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesVoucherService],
    }).compile();

    service = module.get<SalesVoucherService>(SalesVoucherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
