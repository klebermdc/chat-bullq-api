import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class VoiceFreeSlotsDto {
  @ApiProperty() @IsString() @Length(1, 64) conversationId!: string;
  @ApiPropertyOptional({ default: 4 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) count?: number;
}

export class VoiceScheduleDto {
  @ApiProperty() @IsString() @Length(1, 64) conversationId!: string;
  @ApiProperty({ example: '2026-11-16T18:00:00.000Z' }) @IsDateString() startsAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) callId?: string;
}
