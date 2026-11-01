import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class DiaryDayQueryDto {
  @ApiPropertyOptional({ description: 'YYYY-MM-DD. Padrão: o diário mais recente.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day?: string;
}

export class DiaryListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}
