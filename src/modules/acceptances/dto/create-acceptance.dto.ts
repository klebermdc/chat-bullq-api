import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AcceptanceItemDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsNumber()
  qty?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  ref?: string;
}

/**
 * Voucher entregue junto com o aceite. Só o arquivo — o `sha256` NÃO entra
 * aqui de propósito: quem calcula é o backend, lendo o objeto do storage.
 */
export class VoucherRefDto {
  @IsString()
  url!: string;

  @IsString()
  filename!: string;

  @IsNumber()
  size!: number;
}

/** Body opcional do `order-sent`. Sem ele, o endpoint só move o card (legado). */
export class OrderSentDto {
  @IsOptional()
  @IsBoolean()
  withAcceptance?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcceptanceItemDto)
  items?: AcceptanceItemDto[];

  @IsOptional()
  @IsString()
  termText?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoucherRefDto)
  vouchers?: VoucherRefDto[];

  @IsOptional()
  @IsString()
  orderRef?: string;
}
