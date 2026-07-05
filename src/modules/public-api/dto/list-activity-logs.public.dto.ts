import { IsOptional, IsString, IsInt, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListActivityLogsPublicDto {
  @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actorId?: string;
  @ApiPropertyOptional({ description: 'Nome da ação (ex: STATUS_CHANGED)' })
  @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional({ description: 'Data inicial ISO 8601' })
  @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Data final ISO 8601' })
  @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
