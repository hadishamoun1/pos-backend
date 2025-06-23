import { Test, TestingModule } from '@nestjs/testing';
import { ItemNameDescriptionController } from './item-name-description.controller';

describe('ItemNameDescriptionController', () => {
  let controller: ItemNameDescriptionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ItemNameDescriptionController],
    }).compile();

    controller = module.get<ItemNameDescriptionController>(ItemNameDescriptionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
