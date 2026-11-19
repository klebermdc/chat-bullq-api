import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CopilotTurnDto } from './ask.dto';

export class ConsultDto {
  @ApiProperty({ example: 'O que respondo sobre visto pro Canadá?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({ type: [CopilotTurnDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopilotTurnDto)
  history?: CopilotTurnDto[];

  @ApiPropertyOptional({ description: 'Conversa aberta: traz as últimas mensagens como contexto.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Mensagem do cliente clicada ("Perguntar à IA").' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  messageId?: string;
}
