import { Test, TestingModule } from '@nestjs/testing';
import { SalesVoucherController } from './sales-voucher.controller';

describe('SalesVoucherController', () => {
  let controller: SalesVoucherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesVoucherController],
    }).compile();

    controller = module.get<SalesVoucherController>(SalesVoucherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
