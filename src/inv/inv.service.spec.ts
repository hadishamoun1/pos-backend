import { Test, TestingModule } from '@nestjs/testing';
import { InvService } from './inv.service';

describe('InvService', () => {
  let service: InvService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InvService],
    }).compile();

    service = module.get<InvService>(InvService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
