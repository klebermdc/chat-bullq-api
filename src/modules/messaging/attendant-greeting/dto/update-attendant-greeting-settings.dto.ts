import { IsOptional, IsBoolean, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAttendantGreetingSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Use {atendente} para inserir o 1º nome do atendente.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  template?: string;
}
