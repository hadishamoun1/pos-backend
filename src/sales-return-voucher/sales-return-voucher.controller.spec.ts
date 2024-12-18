import { Test, TestingModule } from '@nestjs/testing';
import { SalesReturnVoucherController } from './sales-return-voucher.controller';

describe('SalesReturnVoucherController', () => {
  let controller: SalesReturnVoucherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesReturnVoucherController],
    }).compile();

    controller = module.get<SalesReturnVoucherController>(SalesReturnVoucherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
