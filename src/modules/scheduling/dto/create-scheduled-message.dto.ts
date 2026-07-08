import {
  IsString,
  IsOptional,
  IsObject,
  IsEnum,
  IsISO8601,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateScheduledMessageDto {
  @ApiProperty({ example: 'conversation-id-here' })
  @IsString()
  conversationId: string;

  @ApiProperty({ enum: ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE'] })
  @IsEnum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE'])
  type: string;

  @ApiProperty({ example: { text: 'Olá! Ainda posso te ajudar?' } })
  @IsObject()
  content: Record<string, any>;

  /** Momento do disparo em ISO-8601 (UTC). */
  @ApiProperty({ example: '2026-07-10T13:00:00.000Z' })
  @IsISO8601()
  scheduledAt: string;

  @ApiPropertyOptional({ description: 'Resposta rápida de origem, se houver' })
  @IsOptional()
  @IsString()
  quickReplyId?: string;

  @ApiPropertyOptional({ description: 'Template HSM de origem, se houver' })
  @IsOptional()
  @IsString()
  templateId?: string;

  /** Se true, cancela este agendamento caso o cliente responda antes. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  cancelOnReply?: boolean;
}
