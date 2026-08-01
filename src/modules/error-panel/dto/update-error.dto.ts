import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorIssueStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class UpdateErrorDto {
  @ApiProperty({ enum: ErrorIssueStatus })
  @IsEnum(ErrorIssueStatus)
  status!: ErrorIssueStatus;

  /**
   * Só faz sentido com status MUTED. Ausente = silenciado por tempo
   * indeterminado — o `ErrorAlertService` já trata `mutedUntil` nulo assim.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  mutedUntil?: string;
}
