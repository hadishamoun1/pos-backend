import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierProforma } from '../entities/supplierProforma.entity';
import { SupplierProformaItem } from '../entities/supplierProformaItem.entity';
import { Settings } from '../entities/settings.entity';
import { SupplierProformaService } from './supplier-proforma.service';
import { SupplierProformaController } from './supplier-proforma.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupplierProforma,
      SupplierProformaItem,
      Settings,
    ]),
  ],
  controllers: [SupplierProformaController],
  providers: [SupplierProformaService],
  exports: [SupplierProformaService],
})
export class SupplierProformaModule {}
