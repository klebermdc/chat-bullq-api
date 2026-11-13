import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

const KINDS = ['RETORNO_LIGACAO', 'REUNIAO'] as const;
const STATUSES = ['MARCADO', 'FEITO', 'CANCELADO', 'NAO_ATENDEU'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ListAgendaQueryDto {
  @ApiProperty({ example: '2026-11-16' }) @Matches(DAY) from!: string;
  @ApiProperty({ example: '2026-11-22' }) @Matches(DAY) to!: string;
  @ApiPropertyOptional({ description: 'Só para gestão; atendente sempre vê a própria agenda.' })
  @IsOptional() @IsString() ownerUserId?: string;
}

export class CreateAppointmentDto {
  @ApiProperty() @IsString() @Length(1, 64) contactId!: string;
  @ApiProperty({ example: '2026-11-16T15:00:00-03:00' }) @IsDateString() startsAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ownerUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cardId?: string;
  @ApiPropertyOptional({ default: 15 }) @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) durationMin?: number;
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RescheduleAppointmentDto {
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) durationMin?: number;
}

export class SetAppointmentStatusDto {
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) status!: (typeof STATUSES)[number];
}

export class FreeSlotsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() ownerUserId?: string;
  @ApiPropertyOptional({ default: 4 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) count?: number;
}
