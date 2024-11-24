import { Test, TestingModule } from '@nestjs/testing';
import { SupplierProformaService } from './supplier-proforma.service';

describe('SupplierProformaService', () => {
  let service: SupplierProformaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupplierProformaService],
    }).compile();

    service = module.get<SupplierProformaService>(SupplierProformaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
