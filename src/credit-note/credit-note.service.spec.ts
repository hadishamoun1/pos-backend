import { Test, TestingModule } from '@nestjs/testing';
import { CreditNoteService } from './credit-note.service';

describe('CreditNoteService', () => {
  let service: CreditNoteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditNoteService],
    }).compile();

    service = module.get<CreditNoteService>(CreditNoteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
