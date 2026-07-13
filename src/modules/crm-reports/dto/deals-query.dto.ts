import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Query vem como string (querystring). O service converte/valida os tipos.
export class DealsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() pipelineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() stageIds?: string; // csv
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string; // OPEN|WON|LOST
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() valueMin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() valueMax?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hasProposal?: string; // 'true'|'false'
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string; // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string; // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() dateField?: string; // createdAt|closedAt
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() perPage?: string;
}
