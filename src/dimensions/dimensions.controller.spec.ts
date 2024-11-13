import { Test, TestingModule } from '@nestjs/testing';
import { DimensionsController } from './dimensions.controller';

describe('DimensionsController', () => {
  let controller: DimensionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DimensionsController],
    }).compile();

    controller = module.get<DimensionsController>(DimensionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
