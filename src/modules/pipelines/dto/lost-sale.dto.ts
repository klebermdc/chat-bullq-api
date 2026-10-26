import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LOST_NOTE_MAX_LENGTH,
  LOST_REASON_CODES,
  type LostReason,
} from '../lost-sale.constants';

export class MarkLostDto {
  @ApiProperty({ enum: LOST_REASON_CODES })
  @IsIn(LOST_REASON_CODES)
  reason!: LostReason;

  /** Obrigatória quando o motivo é OTHER (conferido no service). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(LOST_NOTE_MAX_LENGTH)
  note?: string;
}
