import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CostsQueryDto {
  @ApiPropertyOptional({ description: 'Primeiro dia (YYYY-MM-DD, fuso da org)' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ description: 'Último dia, inclusive (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

export class BreakdownQueryDto extends CostsQueryDto {
  @ApiPropertyOptional()
  @IsString()
  channelId!: string;
}
