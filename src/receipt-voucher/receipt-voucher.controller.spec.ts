import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptVoucherController } from './receipt-voucher.controller';

describe('ReceiptVoucherController', () => {
  let controller: ReceiptVoucherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptVoucherController],
    }).compile();

    controller = module.get<ReceiptVoucherController>(ReceiptVoucherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
