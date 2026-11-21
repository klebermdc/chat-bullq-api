import { IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SHORT = 200;

export class OrderLookupPublicDto {
  @ApiPropertyOptional({ example: 'cliente@x.com', description: 'E-mail exato (sem caixa)' })
  @IsOptional()
  @IsString()
  @MaxLength(SHORT)
  email?: string;

  @ApiPropertyOptional({ example: '5562999998888', description: 'Casa pelos últimos 8 dígitos' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

/** Pedido salvo no OFP Hub. Nomes de campo = contrato com o Hub. */
export class OrderWonPublicDto {
  @ApiProperty({ description: 'id (uuid) da linha de pedidos no OFP Hub' })
  @IsUUID()
  externalId: string;

  @ApiPropertyOptional({ example: '4853LD', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(SHORT)
  pedido?: string | null;

  @ApiPropertyOptional({ example: 'Bernardo Vieira', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(SHORT)
  cliente?: string | null;

  @ApiPropertyOptional({ example: 'x@y.com', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(SHORT)
  email?: string | null;

  @ApiPropertyOptional({ example: '5562999998888', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefone?: string | null;

  @ApiPropertyOptional({ example: 21369.49, nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  venda?: number | null;

  @ApiProperty({ example: '2026-11-18', description: 'aaaa-mm-dd' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'data deve ser aaaa-mm-dd' })
  data: string;

  @ApiPropertyOptional({ example: 'Renata', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(SHORT)
  vendedor?: string | null;

  @ApiPropertyOptional({ example: 'Azul Viagens', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(SHORT)
  fornecedor?: string | null;
}
