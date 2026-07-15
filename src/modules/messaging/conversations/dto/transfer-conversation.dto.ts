import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferConversationDto {
  /** Atendente que vai receber o cliente. */
  @ApiProperty()
  @IsString()
  toUserId!: string;

  /** Motivo opcional da transferência, registrado na mensagem SYSTEM. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}
