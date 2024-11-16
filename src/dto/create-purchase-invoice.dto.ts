import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PurchaseInvoiceItemDto {
  @IsNumber()
  dimensionId: number;

  @IsNumber()
  sqm: number;

  @IsNumber()
  unitPrice: number;

  @IsNumber()
  totalAmount: number;
}

export class CreatePurchaseInvoiceDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  supplierName: string;

  @IsNumber()
  exchangeRate: number;

  @IsNumber()
  vatAmount: number;

  @IsNumber()
  grandAmount: number;

  @IsString()
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseInvoiceItemDto)
  items: PurchaseInvoiceItemDto[];
}
