import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const QUICK_REPLY_TITLE_MAX = 80;
/** Mesmo teto de texto de uma mensagem de WhatsApp. */
export const QUICK_REPLY_CONTENT_MAX = 4096;

export class CreateQuickReplyDto {
  /** Normalizado no service (sem barra, minúsculo). */
  @ApiProperty({ example: 'pix' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  shortcut: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUICK_REPLY_TITLE_MAX)
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUICK_REPLY_CONTENT_MAX)
  content: string;
}
