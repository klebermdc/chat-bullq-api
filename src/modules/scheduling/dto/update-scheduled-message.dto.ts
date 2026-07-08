import { IsString, IsOptional, IsObject, IsEnum, IsISO8601 } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateScheduledMessageDto {
  @ApiPropertyOptional({ example: '2026-07-11T15:30:00.000Z' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE'] })
  @IsOptional()
  @IsEnum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE'])
  type?: string;

  @ApiPropertyOptional({ example: { text: 'Novo texto' } })
  @IsOptional()
  @IsObject()
  content?: Record<string, any>;
}
