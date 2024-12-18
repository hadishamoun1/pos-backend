import { Test, TestingModule } from '@nestjs/testing';
import { PaymentVoucherReturnController } from './payment-voucher-return.controller';

describe('PaymentVoucherReturnController', () => {
  let controller: PaymentVoucherReturnController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentVoucherReturnController],
    }).compile();

    controller = module.get<PaymentVoucherReturnController>(PaymentVoucherReturnController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
