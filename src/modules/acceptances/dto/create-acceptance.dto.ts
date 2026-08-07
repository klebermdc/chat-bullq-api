import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Uma entrega são alguns PDFs, não um lote. O teto existe porque cada voucher
 * vira uma leitura no storage dentro do mesmo request (`withHashes`): sem ele,
 * um body com centenas de URLs vira centenas de leituras simultâneas.
 */
const MAX_VOUCHERS = 20;

/** Nº do pedido do operador: um punhado de caracteres, não texto livre. */
const MAX_ORDER_REF_LENGTH = 64;

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
  @ArrayMaxSize(MAX_VOUCHERS)
  @ValidateNested({ each: true })
  @Type(() => VoucherRefDto)
  vouchers?: VoucherRefDto[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORDER_REF_LENGTH)
  orderRef?: string;
}
