import { Test, TestingModule } from '@nestjs/testing';
import { JournalVoucherService } from './journal-voucher.service';

describe('JournalVoucherService', () => {
  let service: JournalVoucherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JournalVoucherService],
    }).compile();

    service = module.get<JournalVoucherService>(JournalVoucherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
