import { Test, TestingModule } from '@nestjs/testing';
import { InventroyTransactionsController } from './inventroy-transactions.controller';

describe('InventroyTransactionsController', () => {
  let controller: InventroyTransactionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventroyTransactionsController],
    }).compile();

    controller = module.get<InventroyTransactionsController>(InventroyTransactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
