import { IsString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { QUICK_REPLY_CONTENT_MAX, QUICK_REPLY_TITLE_MAX } from './create-quick-reply.dto';

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
}
