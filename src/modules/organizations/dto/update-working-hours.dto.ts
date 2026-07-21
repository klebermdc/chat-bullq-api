import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, ValidateIf } from 'class-validator';

export class UpdateWorkingHoursDto {
  @ApiPropertyOptional({
    description:
      'Agenda semanal { monday: { enabled, windows: [["09:00","18:00"]] }, ... }. null = sem agenda (feature off).',
    example: { monday: { enabled: true, windows: [['09:00', '18:00']] } },
    nullable: true,
  })
  @IsOptional()
  // @IsObject() sozinho rejeita `null`. workingHours=null é um estado válido
  // (agenda desligada), então só valida como objeto quando não for null —
  // mesmo padrão de `aiBusinessHours` em UpdateOrganizationDto.
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  workingHours?: Record<string, { enabled: boolean; windows?: [string, string][] }> | null;

  @ApiPropertyOptional({ description: 'Ligar o aviso de fora-de-horário para este atendente.' })
  @IsOptional()
  @IsBoolean()
  offHoursNoticeEnabled?: boolean;
}
