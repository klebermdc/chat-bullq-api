import { ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorIssueStatus, ErrorSeverity, ErrorSource } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListErrorsDto {
  @ApiPropertyOptional({ enum: ErrorSource })
  @IsOptional()
  @IsEnum(ErrorSource)
  source?: ErrorSource;

  @ApiPropertyOptional({ enum: ErrorSeverity })
  @IsOptional()
  @IsEnum(ErrorSeverity)
  severity?: ErrorSeverity;

  @ApiPropertyOptional({ enum: ErrorIssueStatus })
  @IsOptional()
  @IsEnum(ErrorIssueStatus)
  status?: ErrorIssueStatus;

  /** Busca no título e no código. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** Teto de 100: a listagem carrega stack de cada issue no detalhe, não aqui. */
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number = 25;
}
