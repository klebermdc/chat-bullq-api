import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_DELAY_MINUTES, MIN_DELAY_MINUTES } from '../website-leads.constants';

export class UpdateWebsiteLeadSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Canal oficial que manda o template.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  channelId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Template (message_templates.id) do retorno.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  templateId?: string | null;

  @ApiPropertyOptional({ minimum: MIN_DELAY_MINUTES, maximum: MAX_DELAY_MINUTES })
  @IsOptional()
  @IsInt()
  @Min(MIN_DELAY_MINUTES)
  @Max(MAX_DELAY_MINUTES)
  delayMinutes?: number;
}
