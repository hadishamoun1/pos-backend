import {
  IsNotEmpty,
  IsString,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsNumber,
} from 'class-validator';

export class CreateCustomerDto {
  @IsNotEmpty()
  @IsString()
  customerName: string;

  @IsNotEmpty()
  @IsNumber()
  currencyId: number;

  @IsOptional()
  @IsBoolean()
  accessible?: boolean;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  financialNumber?: string;

  @IsOptional()
  @IsEnum(['S', 'G'])
  invoiceType?: 'S' | 'G';

  @IsOptional()
  @IsNumber()
  vat?: number;
}
