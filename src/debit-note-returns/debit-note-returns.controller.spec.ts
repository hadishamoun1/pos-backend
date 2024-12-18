import { Test, TestingModule } from '@nestjs/testing';
import { DebitNoteReturnsController } from './debit-note-returns.controller';

describe('DebitNoteReturnsController', () => {
  let controller: DebitNoteReturnsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DebitNoteReturnsController],
    }).compile();

    controller = module.get<DebitNoteReturnsController>(DebitNoteReturnsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
