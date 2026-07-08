import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ReportQueryDto {
  @IsOptional() @IsString()
  vendedor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12)
  month?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year?: number;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  produto?: string;

  @IsOptional() @IsString()
  fornecedor?: string;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsBooleanString()
  includeOrders?: string;
}
