import { Test, TestingModule } from '@nestjs/testing';
import { CreditNoteReturnsController } from './credit-note-returns.controller';

describe('CreditNoteReturnsController', () => {
  let controller: CreditNoteReturnsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreditNoteReturnsController],
    }).compile();

    controller = module.get<CreditNoteReturnsController>(CreditNoteReturnsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
