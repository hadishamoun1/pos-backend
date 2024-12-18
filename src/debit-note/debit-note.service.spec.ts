import { Test, TestingModule } from '@nestjs/testing';
import { DebitNoteService } from './debit-note.service';

describe('DebitNoteService', () => {
  let service: DebitNoteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DebitNoteService],
    }).compile();

    service = module.get<DebitNoteService>(DebitNoteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
