import { Test, TestingModule } from '@nestjs/testing';
import { DebitNoteReturnsService } from './debit-note-returns.service';

describe('DebitNoteReturnsService', () => {
  let service: DebitNoteReturnsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DebitNoteReturnsService],
    }).compile();

    service = module.get<DebitNoteReturnsService>(DebitNoteReturnsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
