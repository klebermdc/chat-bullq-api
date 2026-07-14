import {
  IsString,
  IsOptional,
  IsObject,
  IsEnum,
  IsBoolean,
  IsInt,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CadenceTrigger, CadenceStepOption } from '@prisma/client';

export class UpsertCadenceStepDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  order: number;

  @ApiProperty({ example: 1440, description: 'Atraso em minutos antes do disparo.' })
  @IsInt()
  delayMinutes: number;

  @ApiProperty({ example: { text: 'Oi, {nome}! Tudo bem?' } })
  @IsObject()
  content: Record<string, any>;

  @ApiProperty({ enum: CadenceStepOption, isArray: true, example: ['SIM', 'NAO'] })
  @IsArray()
  @IsEnum(CadenceStepOption, { each: true })
  options: CadenceStepOption[];

  @ApiPropertyOptional({ description: 'Template HSM de origem, se houver' })
  @IsOptional()
  @IsString()
  templateId?: string;
}

export class UpsertCadenceDto {
  @ApiProperty({ example: 'Cadência de negociação' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pipelineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lostStageId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Etapas pré-humanas monitoradas (NO_REPLY). Vazio = qualquer etapa pré-humana.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  watchedStageIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hotTagId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  optOutTagId?: string;

  @ApiProperty({ enum: CadenceTrigger })
  @IsEnum(CadenceTrigger)
  trigger: CadenceTrigger;

  @ApiProperty({ default: false })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ default: true })
  @IsBoolean()
  allowManual: boolean;

  @ApiPropertyOptional({ description: 'Mensagem enviada ao cliente ao responder Sim (antes do handoff).' })
  @IsOptional()
  @IsString()
  onYesMessage?: string;

  @ApiPropertyOptional({ description: 'Mensagem enviada ao cliente ao responder Não (antes de mover para perdido).' })
  @IsOptional()
  @IsString()
  onNoMessage?: string;

  @ApiProperty({ type: [UpsertCadenceStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertCadenceStepDto)
  steps: UpsertCadenceStepDto[];
}
