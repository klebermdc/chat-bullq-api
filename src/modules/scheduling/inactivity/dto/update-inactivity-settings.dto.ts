import { IsOptional, IsBoolean, IsInt, IsArray, ArrayNotEmpty, Min, Max, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateInactivitySettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ type: [Number], example: [3, 7, 15, 30] })
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) @Min(1, { each: true })
  bandsDays?: number[];
  @ApiPropertyOptional({ enum: ['DAYS', 'HOURS'] })
  @IsOptional() @IsIn(['DAYS', 'HOURS']) bandsUnit?: 'DAYS' | 'HOURS';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoReengage?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) reengageFromBand?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxAttempts?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) retryEveryHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(23) quietHoursStart?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(23) quietHoursEnd?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reengageOnlyAiParked?: boolean;
}
