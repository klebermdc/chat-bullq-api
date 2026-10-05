import { IsString, IsOptional, IsNotEmpty, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  QUICK_REPLY_CONTENT_MAX,
  QUICK_REPLY_OWNER_ID_MAX,
  QUICK_REPLY_TITLE_MAX,
} from './create-quick-reply.dto';

export class UpdateQuickReplyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  shortcut?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUICK_REPLY_TITLE_MAX)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUICK_REPLY_CONTENT_MAX)
  content?: string;

  /** Nulo devolve a mensagem para a equipe inteira; ausente não mexe no dono. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUICK_REPLY_OWNER_ID_MAX)
  ownerUserId?: string | null;
}
