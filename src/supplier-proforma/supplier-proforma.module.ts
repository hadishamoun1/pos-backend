import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierProforma } from '../entities/supplierProforma.entity';
import { SupplierProformaService } from './supplier-proforma.service';
import { SupplierProformaController } from './supplier-proforma.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SupplierProforma])],
  controllers: [SupplierProformaController],
  providers: [SupplierProformaService],
  exports: [SupplierProformaService],
})
export class SupplierProformaModule {}
