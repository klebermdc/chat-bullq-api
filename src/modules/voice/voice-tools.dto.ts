import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

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

export class VoiceTranscriptSegmentDto {
  @ApiProperty({ enum: ['cliente', 'vendedor'] }) @IsIn(['cliente', 'vendedor']) quem!: 'cliente' | 'vendedor';
  @ApiProperty() @IsString() @MaxLength(4000) texto!: string;
}

export class VoiceCallTranscriptDto {
  @ApiProperty() @IsString() @Length(1, 64) callId!: string;
  @ApiProperty() @IsBoolean() answered!: boolean;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(6 * 3600) durationSec!: number;
  @ApiProperty({ type: [VoiceTranscriptSegmentDto] })
  @IsArray()
  @ArrayMaxSize(600)
  @ValidateNested({ each: true })
  @Type(() => VoiceTranscriptSegmentDto)
  segments!: VoiceTranscriptSegmentDto[];
}
