import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CONTRACT_STATUS_FILTERS, type ContractStatusFilter } from '../domain/contract-status';

export class ListContractsDto {
  @IsOptional() @IsString() @MaxLength(100) guide?: string;
  @IsOptional() @IsIn(CONTRACT_STATUS_FILTERS as unknown as string[]) status?: ContractStatusFilter;
  /** Busca em nome, e-mail, telefone e CPF. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) perPage?: number = 50;
}

/** `?guide=` das rotas de resumo; repetido (`?guide=a&guide=b`) vira array e dá 400. */
export class GuideQueryDto {
  @IsOptional() @IsString() @MaxLength(100) guide?: string;
}
