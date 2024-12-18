import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptVoucherReturnController } from './receipt-voucher-return.controller';

describe('ReceiptVoucherReturnController', () => {
  let controller: ReceiptVoucherReturnController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptVoucherReturnController],
    }).compile();

    controller = module.get<ReceiptVoucherReturnController>(ReceiptVoucherReturnController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
