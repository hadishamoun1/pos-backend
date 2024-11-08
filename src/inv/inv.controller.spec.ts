import { Test, TestingModule } from '@nestjs/testing';
import { InvController } from './inv.controller';

describe('InvController', () => {
  let controller: InvController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvController],
    }).compile();

    controller = module.get<InvController>(InvController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
