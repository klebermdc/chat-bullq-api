import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class PeriodQueryDto {
  @ApiProperty({ description: 'Início do período (inclusive), formato YYYY-MM-DD', example: '2026-01-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Fim do período (inclusive), formato YYYY-MM-DD', example: '2026-01-31' })
  @IsDateString()
  to!: string;
}
