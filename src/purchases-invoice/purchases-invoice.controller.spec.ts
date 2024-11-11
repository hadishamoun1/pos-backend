import { Test, TestingModule } from '@nestjs/testing';
import { PurchasesInvoiceController } from './purchases-invoice.controller';

describe('PurchasesInvoiceController', () => {
  let controller: PurchasesInvoiceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchasesInvoiceController],
    }).compile();

    controller = module.get<PurchasesInvoiceController>(PurchasesInvoiceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
