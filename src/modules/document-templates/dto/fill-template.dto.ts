import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsStringRecord } from './string-record.validator';

/** Prazo do link do contrato. Padrão = o do aceite de entrega (30 dias). */
export const MIN_EXPIRES_IN_DAYS = 1;
export const MAX_EXPIRES_IN_DAYS = 90;

export class FillTemplateDto {
  @IsOptional()
  @IsStringRecord()
  values?: Record<string, string>;
}

export class CreateContractDto extends FillTemplateDto {
  @IsString()
  @IsNotEmpty({ message: 'Escolha o modelo de contrato.' })
  @MaxLength(64)
  templateId!: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_EXPIRES_IN_DAYS)
  @Max(MAX_EXPIRES_IN_DAYS)
  expiresInDays?: number;
}

export class AutofillQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;
}
