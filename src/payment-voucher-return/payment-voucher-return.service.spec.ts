import { Test, TestingModule } from '@nestjs/testing';
import { PaymentVoucherReturnService } from './payment-voucher-return.service';

describe('PaymentVoucherReturnService', () => {
  let service: PaymentVoucherReturnService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentVoucherReturnService],
    }).compile();

    service = module.get<PaymentVoucherReturnService>(PaymentVoucherReturnService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
