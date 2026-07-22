import { IsString, IsOptional, IsBoolean, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTagDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, {
    message: 'color must be a valid hex color (e.g. #6B7280)',
  })
  color?: string;

  @ApiPropertyOptional({
    description:
      'Marca esta tag como "lead qualificado": aplicá-la dispara o evento LEAD_QUALIFIED (com os dados de atribuição do anúncio) além do TAG_ADDED.',
  })
  @IsOptional()
  @IsBoolean()
  marksQualifiedLead?: boolean;
}
