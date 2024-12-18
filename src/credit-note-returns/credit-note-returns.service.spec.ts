import { Test, TestingModule } from '@nestjs/testing';
import { CreditNoteReturnsService } from './credit-note-returns.service';

describe('CreditNoteReturnsService', () => {
  let service: CreditNoteReturnsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditNoteReturnsService],
    }).compile();

    service = module.get<CreditNoteReturnsService>(CreditNoteReturnsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
