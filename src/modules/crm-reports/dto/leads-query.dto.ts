import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Query vem como string (querystring). O service converte/valida os tipos.
export class LeadsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() channelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tagId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hasProposal?: string; // 'true'|'false'
  @ApiPropertyOptional() @IsOptional() @IsString() hasDeal?: string; // 'true'|'false'
  @ApiPropertyOptional() @IsOptional() @IsString() temperatureMin?: string; // '1'|'2'|'3'
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string; // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string; // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() perPage?: string;
}
