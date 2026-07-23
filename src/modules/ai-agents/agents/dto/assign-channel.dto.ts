import { AiAgentMode, AiAgentTrigger } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignAgentChannelDto {
  @ApiProperty()
  @IsString()
  channelId!: string;

  @ApiPropertyOptional({ enum: AiAgentMode, default: AiAgentMode.AUTONOMOUS })
  @IsOptional()
  @IsEnum(AiAgentMode)
  mode?: AiAgentMode;

  @ApiPropertyOptional({
    enum: AiAgentTrigger,
    default: AiAgentTrigger.ALWAYS,
  })
  @IsOptional()
  @IsEnum(AiAgentTrigger)
  trigger?: AiAgentTrigger;

  /**
   * Escopo opcional por tag: o agente só atua nas conversas que tiverem esta
   * tag (na conversa ou no contato). Usado principalmente pelo modo SHADOW
   * para observar apenas um segmento (ex.: 'guiamento'). null/omitido = canal
   * inteiro.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tagFilterId?: string;
}
