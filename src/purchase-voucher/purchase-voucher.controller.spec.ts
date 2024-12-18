import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseVoucherController } from './purchase-voucher.controller';

describe('PurchaseVoucherController', () => {
  let controller: PurchaseVoucherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseVoucherController],
    }).compile();

    controller = module.get<PurchaseVoucherController>(PurchaseVoucherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
