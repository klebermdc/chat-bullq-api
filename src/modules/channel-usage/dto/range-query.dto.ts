import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/**
 * Intervalo [from, to) dos relatórios de custo e de entrega. A ordem e o
 * tamanho máximo são validados em `resolveUsageRange`.
 */
export class RangeQueryDto {
  @ApiPropertyOptional({ description: 'ISO 8601. Default: 30 dias atrás.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 (exclusivo). Default: agora.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
