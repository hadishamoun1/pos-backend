import { Test, TestingModule } from '@nestjs/testing';
import { SupplierProformaController } from './supplier-proforma.controller';

describe('SupplierProformaController', () => {
  let controller: SupplierProformaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupplierProformaController],
    }).compile();

    controller = module.get<SupplierProformaController>(SupplierProformaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
