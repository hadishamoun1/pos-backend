import { Test, TestingModule } from '@nestjs/testing';
import { ItemNameDescriptionService } from './item-name-description.service';

describe('ItemNameDescriptionService', () => {
  let service: ItemNameDescriptionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ItemNameDescriptionService],
    }).compile();

    service = module.get<ItemNameDescriptionService>(ItemNameDescriptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
