import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseReturnVoucherController } from './purchase-return-voucher.controller';

describe('PurchaseReturnVoucherController', () => {
  let controller: PurchaseReturnVoucherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseReturnVoucherController],
    }).compile();

    controller = module.get<PurchaseReturnVoucherController>(PurchaseReturnVoucherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
