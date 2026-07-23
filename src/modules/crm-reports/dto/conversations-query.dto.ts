import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Query vem como string (querystring). O service converte/valida os tipos.
export class ConversationsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string; // PENDING|BOT|OPEN|WAITING|CLOSED
  @ApiPropertyOptional() @IsOptional() @IsString() channelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tagId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reopened?: string; // 'true'|'false'
  @ApiPropertyOptional() @IsOptional() @IsString() answered?: string; // 'true'|'false'
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string; // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string; // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() perPage?: string;
}
