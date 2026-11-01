import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class GenerateDiaryDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiPropertyOptional({ description: 'Dia avaliado (YYYY-MM-DD). Padrão: ontem.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day?: string;
}
