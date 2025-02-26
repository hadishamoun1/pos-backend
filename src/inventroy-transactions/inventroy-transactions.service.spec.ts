import { Test, TestingModule } from '@nestjs/testing';
import { InventroyTransactionsService } from './inventroy-transactions.service';

describe('InventroyTransactionsService', () => {
  let service: InventroyTransactionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventroyTransactionsService],
    }).compile();

    service = module.get<InventroyTransactionsService>(InventroyTransactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
