import { Test, TestingModule } from '@nestjs/testing';
import { DebitNoteController } from './debit-note.controller';

describe('DebitNoteController', () => {
  let controller: DebitNoteController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DebitNoteController],
    }).compile();

    controller = module.get<DebitNoteController>(DebitNoteController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
