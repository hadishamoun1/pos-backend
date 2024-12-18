import { Test, TestingModule } from '@nestjs/testing';
import { JournalVoucherController } from './journal-voucher.controller';

describe('JournalVoucherController', () => {
  let controller: JournalVoucherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JournalVoucherController],
    }).compile();

    controller = module.get<JournalVoucherController>(JournalVoucherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
